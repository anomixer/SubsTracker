// 訂閱續期通知網站 - 基於CloudFlare Workers (完全最佳化版)

// 時區處理工具函式
// 常量：毫秒轉換為小時/天，便於全域性複用
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

function getCurrentTimeInTimezone(timezone = 'UTC') {
  try {
    // Workers 環境下 Date 始終儲存 UTC 時間，這裡直接返回當前時間物件
    return new Date();
  } catch (error) {
    console.error(`時區轉換錯誤: ${error.message}`);
    // 如果時區無效，返回UTC時間
    return new Date();
  }
}

function getTimestampInTimezone(timezone = 'UTC') {
  return getCurrentTimeInTimezone(timezone).getTime();
}

function convertUTCToTimezone(utcTime, timezone = 'UTC') {
  try {
    // 同 getCurrentTimeInTimezone，一律返回 Date 供後續統一處理
    return new Date(utcTime);
  } catch (error) {
    console.error(`時區轉換錯誤: ${error.message}`);
    return new Date(utcTime);
  }
}

// 獲取指定時區的年/月/日/時/分/秒，便於避免重複的 Intl 解析邏輯
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

// 計算指定日期在目標時區的午夜時間戳（毫秒），用於統一的“剩餘天數”計算
function getTimezoneMidnightTimestamp(date, timezone = 'UTC') {
  const { year, month, day } = getTimezoneDateParts(date, timezone);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

function calculateExpirationTime(expirationMinutes, timezone = 'UTC') {
  const currentTime = getCurrentTimeInTimezone(timezone);
  const expirationTime = new Date(currentTime.getTime() + (expirationMinutes * 60 * 1000));
  return expirationTime;
}

function isExpired(targetTime, timezone = 'UTC') {
  const currentTime = getCurrentTimeInTimezone(timezone);
  const target = new Date(targetTime);
  return currentTime > target;
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
      // full format
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

// 格式化時區顯示，包含UTC偏移
function formatTimezoneDisplay(timezone = 'UTC') {
  try {
    const offset = getTimezoneOffset(timezone);
    const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
    
    // 時區中文名稱對映
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

// 相容性函式 - 保持原有介面
function formatBeijingTime(date = new Date(), format = 'full') {
  return formatTimeInTimezone(date, 'Asia/Shanghai', format);
}

// 時區處理中介軟體函式
function extractTimezone(request) {
  // 優先順序：URL引數 > 請求頭 > 預設值
  const url = new URL(request.url);
  const timezoneParam = url.searchParams.get('timezone');
  
  if (timezoneParam) {
    return timezoneParam;
  }
  
  // 從請求頭獲取時區
  const timezoneHeader = request.headers.get('X-Timezone');
  if (timezoneHeader) {
    return timezoneHeader;
  }
  
  // 從Accept-Language頭推斷時區（簡化處理）
  const acceptLanguage = request.headers.get('Accept-Language');
  if (acceptLanguage) {
    // 簡單的時區推斷邏輯
    if (acceptLanguage.includes('zh')) {
      return 'Asia/Shanghai';
    } else if (acceptLanguage.includes('en-US')) {
      return 'America/New_York';
    } else if (acceptLanguage.includes('en-GB')) {
      return 'Europe/London';
    }
  }
  
  // 預設返回UTC
  return 'UTC';
}

function isValidTimezone(timezone) {
  try {
    // 嘗試使用該時區格式化時間
    new Date().toLocaleString('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
}

// 農曆轉換工具函式
const lunarCalendar = {
  // 農曆資料 (1900-2100年)
  lunarInfo: [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
    0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0
  ],

  // 天干地支
  gan: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
  zhi: ['子', '醜', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],

  // 農曆月份
  months: ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '臘'],

  // 農曆日期
  days: ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
         '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
         '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'],

  // 獲取農曆年天數
  lunarYearDays: function(year) {
    let sum = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) {
      sum += (this.lunarInfo[year - 1900] & i) ? 1 : 0;
    }
    return sum + this.leapDays(year);
  },

  // 獲取閏月天數
  leapDays: function(year) {
    if (this.leapMonth(year)) {
      return (this.lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
    }
    return 0;
  },

  // 獲取閏月月份
  leapMonth: function(year) {
    return this.lunarInfo[year - 1900] & 0xf;
  },

  // 獲取農曆月天數
  monthDays: function(year, month) {
    return (this.lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
  },

  // 公曆轉農曆
  solar2lunar: function(year, month, day) {
    if (year < 1900 || year > 2100) return null;

    const baseDate = new Date(1900, 0, 31);
    const objDate = new Date(year, month - 1, day);
    //let offset = Math.floor((objDate - baseDate) / 86400000);
    let offset = Math.round((objDate - baseDate) / 86400000);


    let temp = 0;
    let lunarYear = 1900;

    for (lunarYear = 1900; lunarYear < 2101 && offset > 0; lunarYear++) {
      temp = this.lunarYearDays(lunarYear);
      offset -= temp;
    }

    if (offset < 0) {
      offset += temp;
      lunarYear--;
    }

    let lunarMonth = 1;
    let leap = this.leapMonth(lunarYear);
    let isLeap = false;

    for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
      if (leap > 0 && lunarMonth === (leap + 1) && !isLeap) {
        --lunarMonth;
        isLeap = true;
        temp = this.leapDays(lunarYear);
      } else {
        temp = this.monthDays(lunarYear, lunarMonth);
      }

      if (isLeap && lunarMonth === (leap + 1)) isLeap = false;
      offset -= temp;
    }

    if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
      if (isLeap) {
        isLeap = false;
      } else {
        isLeap = true;
        --lunarMonth;
      }
    }

    if (offset < 0) {
      offset += temp;
      --lunarMonth;
    }

    const lunarDay = offset + 1;

    // 生成農曆字串
    const ganIndex = (lunarYear - 4) % 10;
    const zhiIndex = (lunarYear - 4) % 12;
    const yearStr = this.gan[ganIndex] + this.zhi[zhiIndex] + '年';
    const monthStr = (isLeap ? '閏' : '') + this.months[lunarMonth - 1] + '月';
    const dayStr = this.days[lunarDay - 1];

    return {
      year: lunarYear,
      month: lunarMonth,
      day: lunarDay,
      isLeap: isLeap,
      yearStr: yearStr,
      monthStr: monthStr,
      dayStr: dayStr,
      fullStr: yearStr + monthStr + dayStr
    };
  }
};

// 1. 新增 lunarBiz 工具模組，支援農曆加週期、農曆轉公曆、農曆距離天數
const lunarBiz = {
  // 農曆加週期，返回新的農曆日期物件
  addLunarPeriod(lunar, periodValue, periodUnit) {
    let { year, month, day, isLeap } = lunar;
    if (periodUnit === 'year') {
      year += periodValue;
      const leap = lunarCalendar.leapMonth(year);
      if (isLeap && leap === month) {
        isLeap = true;
      } else {
        isLeap = false;
      }
    } else if (periodUnit === 'month') {
      let totalMonths = (year - 1900) * 12 + (month - 1) + periodValue;
      year = Math.floor(totalMonths / 12) + 1900;
      month = (totalMonths % 12) + 1;
      const leap = lunarCalendar.leapMonth(year);
      if (isLeap && leap === month) {
        isLeap = true;
      } else {
        isLeap = false;
      }
    } else if (periodUnit === 'day') {
      const solar = lunarBiz.lunar2solar(lunar);
      const date = new Date(solar.year, solar.month - 1, solar.day + periodValue);
      return lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
    }
    let maxDay = isLeap
      ? lunarCalendar.leapDays(year)
      : lunarCalendar.monthDays(year, month);
    let targetDay = Math.min(day, maxDay);
    while (targetDay > 0) {
      let solar = lunarBiz.lunar2solar({ year, month, day: targetDay, isLeap });
      if (solar) {
        return { year, month, day: targetDay, isLeap };
      }
      targetDay--;
    }
    return { year, month, day, isLeap };
  },
  // 農曆轉公曆（遍歷法，適用1900-2100年）
  lunar2solar(lunar) {
    for (let y = lunar.year - 1; y <= lunar.year + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          const date = new Date(y, m - 1, d);
          if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) continue;
          const l = lunarCalendar.solar2lunar(y, m, d);
          if (
            l &&
            l.year === lunar.year &&
            l.month === lunar.month &&
            l.day === lunar.day &&
            l.isLeap === lunar.isLeap
          ) {
            return { year: y, month: m, day: d };
          }
        }
      }
    }
    return null;
  },
  // 距離農曆日期還有多少天
  daysToLunar(lunar) {
    const solar = lunarBiz.lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day);
    const now = new Date();
    return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  }
};

// 定義HTML模板
const loginPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>訂閱管理系統</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
  <style>
    .login-container {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    .login-box {
      backdrop-filter: blur(8px);
      background-color: rgba(255, 255, 255, 0.9);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      transition: all 0.3s;
    }
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
    }
    .input-field {
      transition: all 0.3s;
      border: 1px solid #e2e8f0;
    }
    .input-field:focus {
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.25);
    }
  </style>
</head>
<body class="login-container flex items-center justify-center">
  <div class="login-box p-8 rounded-xl w-full max-w-md">
    <div class="text-center mb-8">
      <h1 class="text-2xl font-bold text-gray-800"><i class="fas fa-calendar-check mr-2"></i>訂閱管理系統</h1>
      <p class="text-gray-600 mt-2">登入管理您的訂閱提醒</p>
    </div>
    
    <form id="loginForm" class="space-y-6">
      <div>
        <label for="username" class="block text-sm font-medium text-gray-700 mb-1">
          <i class="fas fa-user mr-2"></i>使用者名稱
        </label>
        <input type="text" id="username" name="username" required
          class="input-field w-full px-4 py-3 rounded-lg text-gray-700 focus:outline-none">
      </div>
      
      <div>
        <label for="password" class="block text-sm font-medium text-gray-700 mb-1">
          <i class="fas fa-lock mr-2"></i>密碼
        </label>
        <input type="password" id="password" name="password" required
          class="input-field w-full px-4 py-3 rounded-lg text-gray-700 focus:outline-none">
      </div>
      
      <button type="submit" 
        class="btn-primary w-full py-3 rounded-lg text-white font-medium focus:outline-none">
        <i class="fas fa-sign-in-alt mr-2"></i>登入
      </button>
      
      <div id="errorMsg" class="text-red-500 text-center"></div>
    </form>
  </div>
  
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      const button = e.target.querySelector('button');
      const originalContent = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>登入中...';
      button.disabled = true;
      
      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const result = await response.json();
        
        if (result.success) {
          window.location.href = '/admin';
        } else {
          document.getElementById('errorMsg').textContent = result.message || '使用者名稱或密碼錯誤';
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        document.getElementById('errorMsg').textContent = '發生錯誤，請稍後再試';
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    });
  </script>
</body>
</html>
`;

const adminPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>訂閱管理系統</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
  <style>
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: all 0.3s; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-danger { background: linear-gradient(135deg, #f87171 0%, #dc2626 100%); transition: all 0.3s; }
    .btn-danger:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-success { background: linear-gradient(135deg, #34d399 0%, #059669 100%); transition: all 0.3s; }
    .btn-success:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-warning { background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%); transition: all 0.3s; }
    .btn-warning:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-info { background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%); transition: all 0.3s; }
    .btn-info:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .table-container { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
    .modal-container { backdrop-filter: blur(8px); }
    .readonly-input { background-color: #f8fafc; border-color: #e2e8f0; cursor: not-allowed; }
    .error-message { font-size: 0.875rem; margin-top: 0.25rem; display: none; }
    .error-message.show { display: block; }

    /* 通用懸浮提示最佳化 */
    .hover-container {
      position: relative;
      width: 100%;
    }
    .hover-text {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.3s ease;
      display: block;
    }
    .hover-text:hover { color: #3b82f6; }
    .hover-tooltip {
      position: fixed;
      z-index: 9999;
      background: #1f2937;
      color: white;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.875rem;
      max-width: 320px;
      word-wrap: break-word;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      transform: translateY(-10px);
      white-space: normal;
      pointer-events: none;
      line-height: 1.4;
    }
    .hover-tooltip.show {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .hover-tooltip::before {
      content: '';
      position: absolute;
      top: -6px;
      left: 20px;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 6px solid #1f2937;
    }
    .hover-tooltip.tooltip-above::before {
      top: auto;
      bottom: -6px;
      border-bottom: none;
      border-top: 6px solid #1f2937;
    }

    /* 備註顯示最佳化 */
    .notes-container {
      position: relative;
      max-width: 200px;
      width: 100%;
    }
    .notes-text {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.3s ease;
      display: block;
    }
    .notes-text:hover { color: #3b82f6; }
    .notes-tooltip {
      position: fixed;
      z-index: 9999;
      background: #1f2937;
      color: white;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 0.875rem;
      max-width: 320px;
      word-wrap: break-word;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      opacity: 0;
      visibility: hidden;
      transition: all 0.3s ease;
      transform: translateY(-10px);
      white-space: normal;
      pointer-events: none;
      line-height: 1.4;
    }
    .notes-tooltip.show {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }
    .notes-tooltip::before {
      content: '';
      position: absolute;
      top: -6px;
      left: 20px;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-bottom: 6px solid #1f2937;
    }
    .notes-tooltip.tooltip-above::before {
      top: auto;
      bottom: -6px;
      border-bottom: none;
      border-top: 6px solid #1f2937;
    }

    /* 農曆顯示樣式 */
    .lunar-display {
      font-size: 0.75rem;
      color: #6366f1;
      margin-top: 2px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    .lunar-display.show {
      opacity: 1;
    }
    /* 自定義日期選擇器樣式 */
    .hidden {
      display: none !important;
    }
    
    .custom-date-picker {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
      border-radius: 12px;
      min-width: 380px;
    }
    
    .custom-date-picker .calendar-day {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 60px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
      padding: 4px;
      font-size: 14px;
    }
    
    .custom-date-picker .calendar-day:hover {
      background-color: #e0e7ff;
      transform: scale(1.05);
    }
    
    .custom-date-picker .calendar-day.selected {
      background-color: #6366f1;
      color: white;
      transform: scale(1.1);
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
    }
    
    .custom-date-picker .calendar-day.today {
      background-color: #e0e7ff;
      color: #6366f1;
      font-weight: 600;
      border: 2px solid #6366f1;
    }
    
    .custom-date-picker .calendar-day.other-month {
      color: #d1d5db;
    }
    
    .custom-date-picker .calendar-day .lunar-text {
      font-size: 11px;
      line-height: 1.2;
      margin-top: 3px;
      opacity: 0.85;
      text-align: center;
      font-weight: 500;
    }
    
    .custom-date-picker .calendar-day.selected .lunar-text {
      color: rgba(255, 255, 255, 0.9);
    }
    
    .custom-date-picker .calendar-day.today .lunar-text {
      color: #6366f1;
    }
    
    /* 月份和年份選擇器樣式 */
    .month-option, .year-option {
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }
    
    .month-option:hover, .year-option:hover {
      background-color: #e0e7ff !important;
      border-color: #6366f1;
      color: #6366f1;
    }
    
    .month-option.selected, .year-option.selected {
      background-color: #6366f1 !important;
      color: white;
      border-color: #6366f1;
    }
    
    .lunar-toggle {
      display: inline-flex;
      align-items: center;
      margin-bottom: 8px;
      font-size: 0.875rem;
    }
    .lunar-toggle input[type="checkbox"] {
      margin-right: 6px;
    }

    /* 表格佈局最佳化 */
    .table-container {
      width: 100%;
      overflow: visible;
    }

    .table-container table {
      table-layout: fixed;
      width: 100%;
    }

    /* 防止表格內容溢位 */
    .table-container td {
      overflow: hidden;
      word-wrap: break-word;
    }

    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 響應式最佳化 */
    .responsive-table { table-layout: fixed; width: 100%; }
    .td-content-wrapper { word-wrap: break-word; white-space: normal; text-align: left; width: 100%; }
    .td-content-wrapper > * { text-align: left; } /* Align content left within the wrapper */

    @media (max-width: 767px) {
      .table-container { overflow-x: initial; } /* Override previous setting */
      .responsive-table thead { display: none; }
      .responsive-table tbody, .responsive-table tr, .responsive-table td { display: block; width: 100%; }
      .responsive-table tr { margin-bottom: 1.5rem; border: 1px solid #ddd; border-radius: 0.5rem; box-shadow: 0 2px 4px rgba(0,0,0,0.05); overflow: hidden; }
      .responsive-table td { display: flex; justify-content: flex-start; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid #eee; }
      .responsive-table td:last-of-type { border-bottom: none; }
      .responsive-table td:before { content: attr(data-label); font-weight: 600; text-align: left; padding-right: 1rem; color: #374151; white-space: nowrap; }
      .action-buttons-wrapper { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
      
      .notes-container, .hover-container {
        max-width: 180px; /* Adjust for new layout */
        text-align: right;
      }
      .td-content-wrapper .notes-text {
        text-align: right;
      }
     }
    @media (max-width: 767px) {
      #systemTimeDisplay {
        display: none !important;
      }
    }
    @media (min-width: 768px) {
      .table-container {
        overflow: visible;
      }
      /* .td-content-wrapper is aligned left by default */
    }

    /* Toast 樣式 */
    .toast {
      position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px;
      color: white; font-weight: 500; z-index: 1000; transform: translateX(400px);
      transition: all 0.3s ease-in-out; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .toast.show { transform: translateX(0); }
    .toast.success { background-color: #10b981; }
    .toast.error { background-color: #ef4444; }
    .toast.info { background-color: #3b82f6; }
    .toast.warning { background-color: #f59e0b; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div id="toast-container"></div>

  <nav class="bg-white shadow-md">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex items-center">
          <i class="fas fa-calendar-check text-indigo-600 text-2xl mr-2"></i>
          <span class="font-bold text-xl text-gray-800">訂閱管理系統</span>
          <span id="systemTimeDisplay" class="ml-4 text-base text-indigo-600 font-normal"></span>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/admin" class="text-indigo-600 border-b-2 border-indigo-600 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-list mr-1"></i>訂閱列表
          </a>
          <a href="/admin/config" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-cog mr-1"></i>系統配置
          </a>
          <a href="/api/logout" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-sign-out-alt mr-1"></i>退出登入
          </a>
        </div>
      </div>
    </div>
  </nav>
  
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
      <div>
        <h2 class="text-2xl font-bold text-gray-800">訂閱列表</h2>
        <p class="text-sm text-gray-500 mt-1">使用搜索與分類快速定位訂閱，開啟農曆顯示可同步檢視農曆日期</p>
      </div>
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 w-full">
        <div class="flex flex-col sm:flex-row sm:items-center gap-3 w-full lg:flex-1 lg:max-w-2xl">
          <div class="relative flex-1 min-w-[200px] lg:max-w-md">
            <input type="text" id="searchKeyword" placeholder="搜尋名稱、型別或備註..." class="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">
              <i class="fas fa-search"></i>
            </span>
          </div>
          <div class="sm:w-44 lg:w-40">
            <select id="categoryFilter" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white">
              <option value="">全部分類</option>
            </select>
          </div>
        </div>
        <div class="flex items-center space-x-3 lg:space-x-4">
        <label class="lunar-toggle">
          <input type="checkbox" id="listShowLunar" class="form-checkbox h-4 w-4 text-indigo-600 shrink-0">
          <span class="text-gray-700">顯示農曆</span>
        </label>
        <button id="addSubscriptionBtn" class="btn-primary text-white px-4 py-2 rounded-md text-sm font-medium flex items-center shrink-0">
          <i class="fas fa-plus mr-2"></i>新增新訂閱
        </button>
      </div>
      </div>
    </div>
    
    <div class="table-container bg-white rounded-lg overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full divide-y divide-gray-200 responsive-table">
          <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 25%;">
                名稱
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 15%;">
                型別
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 20%;">
                到期時間 <i class="fas fa-sort-up ml-1 text-indigo-500" title="按到期時間升序排列"></i>
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 15%;">
                提醒設定
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 10%;">
                狀態
              </th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 15%;">
                操作
              </th>
            </tr>
          </thead>
        <tbody id="subscriptionsBody" class="bg-white divide-y divide-gray-200">
        </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- 新增/編輯訂閱的模態框 -->
  <div id="subscriptionModal" class="fixed inset-0 bg-gray-600 bg-opacity-50 modal-container hidden flex items-center justify-center z-50">
    <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-screen overflow-y-auto">
      <div class="bg-gray-50 px-6 py-4 border-b border-gray-200 rounded-t-lg">
        <div class="flex items-center justify-between">
          <h3 id="modalTitle" class="text-lg font-medium text-gray-900">新增新訂閱</h3>
          <button id="closeModal" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times text-xl"></i>
          </button>
        </div>
      </div>
      
      <form id="subscriptionForm" class="p-6 space-y-6">
        <input type="hidden" id="subscriptionId">
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label for="name" class="block text-sm font-medium text-gray-700 mb-1">訂閱名稱 *</label>
            <input type="text" id="name" required
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <div class="error-message text-red-500" data-for="reminderValue"></div>
          </div>
          
          <div>
            <label for="customType" class="block text-sm font-medium text-gray-700 mb-1">訂閱型別</label>
            <input type="text" id="customType" placeholder="例如：流媒體、雲服務、軟體、生日等"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <div class="error-message text-red-500"></div>
          </div>

          <div>
            <label for="category" class="block text-sm font-medium text-gray-700 mb-1">分類標籤</label>
            <input type="text" id="category" placeholder="例如：個人、家庭、公司"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <p class="mt-1 text-xs text-gray-500">可輸入多個標籤並使用“/”分隔，便於篩選和統計</p>
            <div class="error-message text-red-500"></div>
          </div>
        </div>
        
        <div class="mb-4 flex items-center space-x-6">
          <label class="lunar-toggle">
            <input type="checkbox" id="showLunar" class="form-checkbox h-4 w-4 text-indigo-600">
            <span class="text-gray-700">顯示農曆日期</span>
          </label>
          <label class="lunar-toggle">
            <input type="checkbox" id="useLunar" class="form-checkbox h-4 w-4 text-indigo-600">
            <span class="text-gray-700">週期按農曆</span>
          </label>
        </div>

                <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="md:col-span-2">
            <label for="startDate" class="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
            <div class="relative">
              <input type="text" id="startDate"
                class="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="YYYY-MM-DD 或點選右側圖示選擇">
              <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <i class="fas fa-calendar text-gray-400"></i>
              </div>
                              <div id="startDatePicker" class="custom-date-picker hidden absolute top-full left-0 z-50 bg-white border border-gray-300 rounded-md shadow-lg p-6 min-w-[380px]">
                  <div class="flex justify-between items-center mb-4">
                    <button type="button" id="startDatePrevMonth" class="text-gray-600 hover:text-gray-800">
                      <i class="fas fa-chevron-left"></i>
                    </button>
                    <div class="flex items-center space-x-2">
                      <span id="startDateMonth" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">1月</span>
                      <span class="text-gray-400">|</span>
                      <span id="startDateYear" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">2024</span>
                    </div>
                    <button type="button" id="startDateNextMonth" class="text-gray-600 hover:text-gray-800">
                      <i class="fas fa-chevron-right"></i>
                    </button>
                  </div>
                  
                  <!-- 月份選擇器 -->
                  <div id="startDateMonthPicker" class="hidden mb-4">
                    <div class="flex justify-between items-center mb-3">
                      <span class="font-medium text-gray-900">選擇月份</span>
                      <button type="button" id="startDateBackToCalendar" class="text-gray-600 hover:text-gray-800">
                        <i class="fas fa-times"></i>
                      </button>
                    </div>
                    <div class="grid grid-cols-3 gap-2">
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="0">1月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="1">2月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="2">3月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="3">4月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="4">5月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="5">6月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="6">7月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="7">8月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="8">9月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="9">10月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="10">11月</button>
                      <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="11">12月</button>
                    </div>
                  </div>
                  
                  <!-- 年份選擇器 -->
                  <div id="startDateYearPicker" class="hidden mb-4">
                    <div class="flex justify-between items-center mb-3">
                      <span class="font-medium text-gray-900">選擇年份</span>
                      <button type="button" id="startDateBackToCalendarFromYear" class="text-gray-600 hover:text-gray-800">
                        <i class="fas fa-times"></i>
                      </button>
                    </div>
                    <div class="flex justify-between items-center mb-3">
                      <button type="button"  id="startDatePrevYearDecade" class="text-gray-600 hover:text-gray-800">
                        <i class="fas fa-chevron-left"></i>
                      </button>
                      <span id="startDateYearRange" class="font-medium text-gray-900">2020-2029</span>
                      <button type="button"  id="startDateNextYearDecade" class="text-gray-600 hover:text-gray-800">
                        <i class="fas fa-chevron-right"></i>
                      </button>
                    </div>
                    <div id="startDateYearGrid" class="grid grid-cols-3 gap-2">
                      <!-- 年份按鈕將透過JavaScript動態生成 -->
                    </div>
                  </div>
                  
                  <div class="grid grid-cols-7 gap-2 mb-3">
                    <div class="text-center text-sm font-semibold text-gray-600 py-2">日</div>
                    <div class="text-center text-sm font-semibold text-gray-600 py-2">一</div>
                    <div class="text-center text-sm font-semibold text-gray-600 py-2">二</div>
                    <div class="text-center text-sm font-semibold text-gray-600 py-2">三</div>
                    <div class="text-center text-sm font-semibold text-gray-600 py-2">四</div>
                    <div class="text-center text-sm font-semibold text-gray-600 py-2">五</div>
                    <div class="text-center text-sm font-semibold text-gray-600 py-2">六</div>
                  </div>
                  <div id="startDateCalendar" class="grid grid-cols-7 gap-2"></div>
                  
                  <!-- 回到今天按鈕 -->
                  <div class="mt-4 pt-3 border-t border-gray-200">
                    <button type="button" id="startDateGoToToday" class="w-full px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-md">
                      <i class="fas fa-calendar-day mr-2"></i>回到今天
                    </button>
                  </div>
                </div>
            </div>
            <div id="startDateLunar" class="lunar-display"></div>
            <div class="error-message text-red-500"></div>
          </div>
          
          <div>
            <label for="periodValue" class="block text-sm font-medium text-gray-700 mb-1">週期數值 *</label>
            <input type="number" id="periodValue" min="1" value="1" required
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
            <div class="error-message text-red-500"></div>
          </div>
          
          <div>
            <label for="periodUnit" class="block text-sm font-medium text-gray-700 mb-1">週期單位 *</label>
            <select id="periodUnit" required
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
              <option value="day">天</option>
              <option value="month" selected>月</option>
              <option value="year">年</option>
            </select>
            <div class="error-message text-red-500"></div>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="expiryDate" class="block text-sm font-medium text-gray-700 mb-1">到期日期 *</label>
            <div class="relative">
              <input type="text" id="expiryDate" required
                class="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="YYYY-MM-DD 或點選右側圖示選擇">
              <div class="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <i class="fas fa-calendar text-gray-400"></i>
              </div>
              <div id="expiryDatePicker" class="custom-date-picker hidden absolute top-full left-0 z-50 bg-white border border-gray-300 rounded-md shadow-lg p-6 min-w-[380px]">
                <div class="flex justify-between items-center mb-4">
                  <button type="button" id="expiryDatePrevMonth" class="text-gray-600 hover:text-gray-800">
                    <i class="fas fa-chevron-left"></i>
                  </button>
                  <div class="flex items-center space-x-2">
                    <span id="expiryDateMonth" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">1月</span>
                    <span class="text-gray-400">|</span>
                    <span id="expiryDateYear" class="font-medium text-gray-900 cursor-pointer hover:text-indigo-600">2024</span>
                  </div>
                  <button type="button" id="expiryDateNextMonth" class="text-gray-600 hover:text-gray-800">
                    <i class="fas fa-chevron-right"></i>
                  </button>
                </div>
                
                <!-- 月份選擇器 -->
                <div id="expiryDateMonthPicker" class="hidden mb-4">
                  <div class="flex justify-between items-center mb-3">
                    <span class="font-medium text-gray-900">選擇月份</span>
                    <button type="button" id="expiryDateBackToCalendar" class="text-gray-600 hover:text-gray-800">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="0">1月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="1">2月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="2">3月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="3">4月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="4">5月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="5">6月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="6">7月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="7">8月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="8">9月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="9">10月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="10">11月</button>
                    <button type="button" class="month-option px-3 py-2 text-sm rounded hover:bg-gray-100" data-month="11">12月</button>
                  </div>
                </div>
                
                <!-- 年份選擇器 -->
                <div id="expiryDateYearPicker" class="hidden mb-4">
                  <div class="flex justify-between items-center mb-3">
                    <span class="font-medium text-gray-900">選擇年份</span>
                    <button type="button" id="expiryDateBackToCalendarFromYear" class="text-gray-600 hover:text-gray-800">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                  <div class="flex justify-between items-center mb-3">
                    <button  type="button" id="expiryDatePrevYearDecade" class="text-gray-600 hover:text-gray-800">
                      <i class="fas fa-chevron-left"></i>
                    </button>
                    <span id="expiryDateYearRange" class="font-medium text-gray-900">2020-2029</span>
                    <button  type="button"  id="expiryDateNextYearDecade" class="text-gray-600 hover:text-gray-800">
                      <i class="fas fa-chevron-right"></i>
                    </button>
                  </div>
                  <div id="expiryDateYearGrid" class="grid grid-cols-3 gap-2">
                    <!-- 年份按鈕將透過JavaScript動態生成 -->
                  </div>
                </div>
                
                <div class="grid grid-cols-7 gap-2 mb-3">
                  <div class="text-center text-sm font-semibold text-gray-600 py-2">日</div>
                  <div class="text-center text-sm font-semibold text-gray-600 py-2">一</div>
                  <div class="text-center text-sm font-semibold text-gray-600 py-2">二</div>
                  <div class="text-center text-sm font-semibold text-gray-600 py-2">三</div>
                  <div class="text-center text-sm font-semibold text-gray-600 py-2">四</div>
                  <div class="text-center text-sm font-semibold text-gray-600 py-2">五</div>
                  <div class="text-center text-sm font-semibold text-gray-600 py-2">六</div>
                </div>
                <div id="expiryDateCalendar" class="grid grid-cols-7 gap-2"></div>
                
                <!-- 回到今天按鈕 -->
                <div class="mt-4 pt-3 border-t border-gray-200">
                  <button type="button" id="expiryDateGoToToday" class="w-full px-3 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-md">
                    <i class="fas fa-calendar-day mr-2"></i>回到今天
                  </button>
                </div>
              </div>
            </div>
            <div id="expiryDateLunar" class="lunar-display"></div>
            <div class="error-message text-red-500"></div>
            <div class="flex justify-end mt-2">
              <button type="button" id="calculateExpiryBtn" 
                class="btn-primary text-white px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap">
                <i class="fas fa-calculator mr-2"></i>自動計算到期日期
              </button>
            </div>
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label for="reminderValue" class="block text-sm font-medium text-gray-700 mb-1">提醒提前量</label>
            <div class="flex space-x-3">
              <input type="number" id="reminderValue" min="0" value="7"
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
              <select id="reminderUnit"
                class="w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white">
                <option value="day" selected>天</option>
                <option value="hour">小時</option>
              </select>
            </div>
            <p class="text-xs text-gray-500 mt-1">0 = 僅在到期時提醒；選擇“小時”需要將 Worker 定時任務調整為小時級執行</p>
            <div class="error-message text-red-500"></div>
          </div>
          
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-3">選項設定</label>
            <div class="space-y-2">
              <label class="inline-flex items-center">
                <input type="checkbox" id="isActive" checked 
                  class="form-checkbox h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">啟用訂閱</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" id="autoRenew" checked 
                  class="form-checkbox h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">自動續訂</span>
              </label>
            </div>
          </div>
        </div>
        
        <div>
          <label for="notes" class="block text-sm font-medium text-gray-700 mb-1">備註</label>
          <textarea id="notes" rows="3" placeholder="可新增相關備註資訊..."
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"></textarea>
          <div class="error-message text-red-500"></div>
        </div>
        
        <div class="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <button type="button" id="cancelBtn" 
            class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50">
            取消
          </button>
          <button type="submit" 
            class="btn-primary text-white px-4 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-save mr-2"></i>儲存
          </button>
        </div>
      </form>
    </div>
  </div>

  <script>
    // 相容性函式 - 保持原有介面
    function formatBeijingTime(date = new Date(), format = 'full') {
      try {
        const timezone = 'Asia/Shanghai';
        const dateObj = new Date(date);
        
        if (format === 'date') {
          return dateObj.toLocaleDateString('zh-CN', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        } else if (format === 'datetime') {
          return dateObj.toLocaleString('zh-CN', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
        } else {
          // full format
          return dateObj.toLocaleString('zh-CN', {
            timeZone: timezone
          });
        }
      } catch (error) {
        console.error('時間格式化錯誤: ' + error.message);
        return new Date(date).toISOString();
      }
    }

    // 農曆轉換工具函式 - 前端版本
    const lunarCalendar = {
      // 農曆資料 (1900-2100年)
      lunarInfo: [
        0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
        0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
        0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
        0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
        0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
        0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
        0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
        0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
        0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
        0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
        0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
        0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
        0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
        0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
        0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0
      ],

      // 天干地支
      gan: ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'],
      zhi: ['子', '醜', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'],

      // 農曆月份
      months: ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '臘'],

      // 農曆日期
      days: ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
             '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
             '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'],

      // 獲取農曆年天數
      lunarYearDays: function(year) {
        let sum = 348;
        for (let i = 0x8000; i > 0x8; i >>= 1) {
          sum += (this.lunarInfo[year - 1900] & i) ? 1 : 0;
        }
        return sum + this.leapDays(year);
      },

      // 獲取閏月天數
      leapDays: function(year) {
        if (this.leapMonth(year)) {
          return (this.lunarInfo[year - 1900] & 0x10000) ? 30 : 29;
        }
        return 0;
      },

      // 獲取閏月月份
      leapMonth: function(year) {
        return this.lunarInfo[year - 1900] & 0xf;
      },

      // 獲取農曆月天數
      monthDays: function(year, month) {
        return (this.lunarInfo[year - 1900] & (0x10000 >> month)) ? 30 : 29;
      },

      // 公曆轉農曆
      solar2lunar: function(year, month, day) {
        if (year < 1900 || year > 2100) return null;

        const baseDate = new Date(1900, 0, 31);
        const objDate = new Date(year, month - 1, day);
        //let offset = Math.floor((objDate - baseDate) / 86400000);
        let offset = Math.round((objDate - baseDate) / 86400000);


        let temp = 0;
        let lunarYear = 1900;

        for (lunarYear = 1900; lunarYear < 2101 && offset > 0; lunarYear++) {
          temp = this.lunarYearDays(lunarYear);
          offset -= temp;
        }

        if (offset < 0) {
          offset += temp;
          lunarYear--;
        }

        let lunarMonth = 1;
        let leap = this.leapMonth(lunarYear);
        let isLeap = false;

        for (lunarMonth = 1; lunarMonth < 13 && offset > 0; lunarMonth++) {
          if (leap > 0 && lunarMonth === (leap + 1) && !isLeap) {
            --lunarMonth;
            isLeap = true;
            temp = this.leapDays(lunarYear);
          } else {
            temp = this.monthDays(lunarYear, lunarMonth);
          }

          if (isLeap && lunarMonth === (leap + 1)) isLeap = false;
          offset -= temp;
        }

        if (offset === 0 && leap > 0 && lunarMonth === leap + 1) {
          if (isLeap) {
            isLeap = false;
          } else {
            isLeap = true;
            --lunarMonth;
          }
        }

        if (offset < 0) {
          offset += temp;
          --lunarMonth;
        }

        const lunarDay = offset + 1;

        // 生成農曆字串
        const ganIndex = (lunarYear - 4) % 10;
        const zhiIndex = (lunarYear - 4) % 12;
        const yearStr = this.gan[ganIndex] + this.zhi[zhiIndex] + '年';
        const monthStr = (isLeap ? '閏' : '') + this.months[lunarMonth - 1] + '月';
        const dayStr = this.days[lunarDay - 1];

        return {
          year: lunarYear,
          month: lunarMonth,
          day: lunarDay,
          isLeap: isLeap,
          yearStr: yearStr,
          monthStr: monthStr,
          dayStr: dayStr,
          fullStr: yearStr + monthStr + dayStr
        };
      }
    };
	

// 新增修改，農曆轉公曆（簡化，適用1900-2100年）
function lunar2solar(lunar) {
  for (let y = lunar.year - 1; y <= lunar.year + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const date = new Date(y, m - 1, d);
        if (date.getFullYear() !== y || date.getMonth() + 1 !== m || date.getDate() !== d) continue;
        const l = lunarCalendar.solar2lunar(y, m, d);
        if (
          l &&
          l.year === lunar.year &&
          l.month === lunar.month &&
          l.day === lunar.day &&
          l.isLeap === lunar.isLeap
        ) {
          return { year: y, month: m, day: d };
        }
      }
    }
  }
  return null;
}

// 新增修改，農曆加週期，前期版本
function addLunarPeriod(lunar, periodValue, periodUnit) {
  let { year, month, day, isLeap } = lunar;
  if (periodUnit === 'year') {
    year += periodValue;
    const leap = lunarCalendar.leapMonth(year);
    if (isLeap && leap === month) {
      isLeap = true;
    } else {
      isLeap = false;
    }
  } else if (periodUnit === 'month') {
    let totalMonths = (year - 1900) * 12 + (month - 1) + periodValue;
    year = Math.floor(totalMonths / 12) + 1900;
    month = (totalMonths % 12) + 1;
    const leap = lunarCalendar.leapMonth(year);
    if (isLeap && leap === month) {
      isLeap = true;
    } else {
      isLeap = false;
    }
  } else if (periodUnit === 'day') {
    const solar = lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day + periodValue);
    return lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }
  let maxDay = isLeap
    ? lunarCalendar.leapDays(year)
    : lunarCalendar.monthDays(year, month);
  let targetDay = Math.min(day, maxDay);
  while (targetDay > 0) {
    let solar = lunar2solar({ year, month, day: targetDay, isLeap });
    if (solar) {
      return { year, month, day: targetDay, isLeap };
    }
    targetDay--;
  }
  return { year, month, day, isLeap };
}

// 前端版本的 lunarBiz 物件
const lunarBiz = {
  // 農曆加週期，返回新的農曆日期物件
  addLunarPeriod(lunar, periodValue, periodUnit) {
    return addLunarPeriod(lunar, periodValue, periodUnit);
  },
  // 農曆轉公曆（遍歷法，適用1900-2100年）
  lunar2solar(lunar) {
    return lunar2solar(lunar);
  },
  // 距離農曆日期還有多少天
  daysToLunar(lunar) {
    const solar = lunarBiz.lunar2solar(lunar);
    const date = new Date(solar.year, solar.month - 1, solar.day);
    const now = new Date();
    return Math.ceil((date - now) / (1000 * 60 * 60 * 24));
  }
};



    // 農曆顯示相關函式
    function updateLunarDisplay(dateInputId, lunarDisplayId) {
      const dateInput = document.getElementById(dateInputId);
      const lunarDisplay = document.getElementById(lunarDisplayId);
      const showLunar = document.getElementById('showLunar');

      if (!dateInput || !lunarDisplay) {
        return;
      }

      if (!dateInput.value || !showLunar || !showLunar.checked) {
        lunarDisplay.classList.remove('show');
        return;
      }

      const date = new Date(dateInput.value);
      const lunar = lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());

      if (lunar) {
        lunarDisplay.textContent = '農曆：' + lunar.fullStr;
        lunarDisplay.classList.add('show');
      } else {
        lunarDisplay.classList.remove('show');
      }
    }

    function toggleLunarDisplay() {
      const showLunar = document.getElementById('showLunar');
      if (!showLunar) {
        return;
      }
      
      updateLunarDisplay('startDate', 'startDateLunar');
      updateLunarDisplay('expiryDate', 'expiryDateLunar');

      // 儲存使用者偏好
      localStorage.setItem('showLunar', showLunar.checked);
    }

    function loadLunarPreference() {
      const showLunar = document.getElementById('showLunar');
      if (!showLunar) {
        return;
      }
      
      const saved = localStorage.getItem('showLunar');
      if (saved !== null) {
        showLunar.checked = saved === 'true';
      } else {
        showLunar.checked = true; // 預設顯示
      }
      toggleLunarDisplay();
    }

    function handleListLunarToggle() {
      const listShowLunar = document.getElementById('listShowLunar');
      // 儲存使用者偏好
      localStorage.setItem('showLunar', listShowLunar.checked);
      // 重新載入訂閱列表以應用農曆顯示設定
      renderSubscriptionTable();
    }

    function showToast(message, type = 'success', duration = 3000) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      
      const icon = type === 'success' ? 'check-circle' :
                   type === 'error' ? 'exclamation-circle' :
                   type === 'warning' ? 'exclamation-triangle' : 'info-circle';
      
      toast.innerHTML = '<div class="flex items-center"><i class="fas fa-' + icon + ' mr-2"></i><span>' + message + '</span></div>';
      
      container.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 100);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, 300);
      }, duration);
    }

    function showFieldError(fieldId, message) {
      const field = document.getElementById(fieldId);
      let errorDiv = field.parentElement ? field.parentElement.querySelector('.error-message') : null;
      if (!errorDiv) {
        errorDiv = document.querySelector('.error-message[data-for="' + fieldId + '"]');
      }
      if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.classList.add('show');
        field.classList.add('border-red-500');
      }
    }

    function clearFieldErrors() {
      document.querySelectorAll('.error-message').forEach(el => {
        el.classList.remove('show');
        el.textContent = '';
      });
      document.querySelectorAll('.border-red-500').forEach(el => {
        el.classList.remove('border-red-500');
      });
    }

    function validateForm() {
      clearFieldErrors();
      let isValid = true;

      const name = document.getElementById('name').value.trim();
      if (!name) {
        showFieldError('name', '請輸入訂閱名稱');
        isValid = false;
      }

      const periodValue = document.getElementById('periodValue').value;
      if (!periodValue || periodValue < 1) {
        showFieldError('periodValue', '週期數值必須大於0');
        isValid = false;
      }

      const expiryDate = document.getElementById('expiryDate').value;
      if (!expiryDate) {
        showFieldError('expiryDate', '請選擇到期日期');
        isValid = false;
      }

      const reminderValueField = document.getElementById('reminderValue');
      const reminderValue = reminderValueField.value;
      if (reminderValue === '' || Number(reminderValue) < 0) {
        showFieldError('reminderValue', '提醒值不能為負數');
        isValid = false;
      }

      return isValid;
    }

    // 建立帶懸浮提示的文字元素
    function createHoverText(text, maxLength = 30, className = 'text-sm text-gray-900') {
      if (!text || text.length <= maxLength) {
        return '<div class="' + className + '">' + text + '</div>';
      }

      const truncated = text.substring(0, maxLength) + '...';
      return '<div class="hover-container">' +
        '<div class="hover-text ' + className + '" data-full-text="' + text.replace(/"/g, '&quot;') + '">' +
          truncated +
        '</div>' +
        '<div class="hover-tooltip"></div>' +
      '</div>';
    }

    const categorySeparator = /[\/,，\s]+/;
    let subscriptionsCache = [];
    let searchDebounceTimer = null;

    function normalizeCategoryTokens(category = '') {
      return category
        .split(categorySeparator)
        .map(token => token.trim())
        .filter(token => token.length > 0);
    }

    function populateCategoryFilter(subscriptions) {
      const select = document.getElementById('categoryFilter');
      if (!select) {
        return;
      }

      const previousValue = select.value;
      const categories = new Set();

      (subscriptions || []).forEach(subscription => {
        normalizeCategoryTokens(subscription.category).forEach(token => categories.add(token));
      });

      const sorted = Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      select.innerHTML = '';

      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = '全部分類';
      select.appendChild(defaultOption);

      sorted.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
      });

      if (previousValue && sorted.map(item => item.toLowerCase()).includes(previousValue.toLowerCase())) {
        select.value = previousValue;
      } else {
        select.value = '';
      }
    }

    function getReminderSettings(subscription) {
      const fallbackDays = subscription.reminderDays !== undefined ? subscription.reminderDays : 7;
      let unit = subscription.reminderUnit || '';
      let value = subscription.reminderValue;

      if (unit !== 'hour') {
        unit = 'day';
      }

      if (unit === 'hour' && (value === undefined || value === null || isNaN(value))) {
        value = subscription.reminderHours !== undefined ? subscription.reminderHours : 0;
      }

      if (value === undefined || value === null || isNaN(value)) {
        value = fallbackDays;
      }

      value = Number(value);

      return {
        unit,
        value,
        displayText: unit === 'hour' ? '提前' + value + '小時' : '提前' + value + '天'
      };
    }

    function attachHoverListeners() {
      function positionTooltip(element, tooltip) {
        const rect = element.getBoundingClientRect();
        const tooltipHeight = 100;
        const viewportHeight = window.innerHeight;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        let top = rect.bottom + scrollTop + 8;
        let left = rect.left;

        if (rect.bottom + tooltipHeight > viewportHeight) {
          top = rect.top + scrollTop - tooltipHeight - 8;
          tooltip.style.transform = 'translateY(10px)';
          tooltip.classList.add('tooltip-above');
        } else {
          tooltip.style.transform = 'translateY(-10px)';
          tooltip.classList.remove('tooltip-above');
        }

        const maxLeft = window.innerWidth - 320 - 20;
        if (left > maxLeft) {
          left = maxLeft;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      }

      document.querySelectorAll('.notes-text').forEach(notesElement => {
        const fullNotes = notesElement.getAttribute('data-full-notes');
        const tooltip = notesElement.parentElement.querySelector('.notes-tooltip');

        if (fullNotes && tooltip) {
          notesElement.addEventListener('mouseenter', () => {
            tooltip.textContent = fullNotes;
            positionTooltip(notesElement, tooltip);
            tooltip.classList.add('show');
          });

          notesElement.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
          });

          window.addEventListener('scroll', () => {
            if (tooltip.classList.contains('show')) {
              tooltip.classList.remove('show');
            }
          }, { passive: true });
        }
      });

      document.querySelectorAll('.hover-text').forEach(hoverElement => {
        const fullText = hoverElement.getAttribute('data-full-text');
        const tooltip = hoverElement.parentElement.querySelector('.hover-tooltip');

        if (fullText && tooltip) {
          hoverElement.addEventListener('mouseenter', () => {
            tooltip.textContent = fullText;
            positionTooltip(hoverElement, tooltip);
            tooltip.classList.add('show');
          });

          hoverElement.addEventListener('mouseleave', () => {
            tooltip.classList.remove('show');
          });

          window.addEventListener('scroll', () => {
            if (tooltip.classList.contains('show')) {
              tooltip.classList.remove('show');
            }
          }, { passive: true });
        }
      });
    }

    function renderSubscriptionTable() {
      const tbody = document.getElementById('subscriptionsBody');
      if (!tbody) {
        return;
      }

      const listShowLunar = document.getElementById('listShowLunar');
      const showLunar = listShowLunar ? listShowLunar.checked : false;
      const searchInput = document.getElementById('searchKeyword');
      const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
      const categorySelect = document.getElementById('categoryFilter');
      const selectedCategory = categorySelect ? categorySelect.value.trim().toLowerCase() : '';

      let filtered = Array.isArray(subscriptionsCache) ? [...subscriptionsCache] : [];

      if (selectedCategory) {
        filtered = filtered.filter(subscription =>
          normalizeCategoryTokens(subscription.category).some(token => token.toLowerCase() === selectedCategory)
        );
      }

      if (keyword) {
        filtered = filtered.filter(subscription => {
          const haystack = [
            subscription.name,
            subscription.customType,
            subscription.notes,
            subscription.category
          ].filter(Boolean).join(' ').toLowerCase();
          return haystack.includes(keyword);
        });
      }

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-500">沒有符合條件的訂閱</td></tr>';
        return;
      }

      filtered.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
      tbody.innerHTML = '';

      const currentTime = new Date();

      filtered.forEach(subscription => {
        const row = document.createElement('tr');
        row.className = subscription.isActive === false ? 'hover:bg-gray-50 bg-gray-100' : 'hover:bg-gray-50';

        const calendarTypeHtml = subscription.useLunar
          ? '<div class="text-xs text-purple-600 mt-1">日曆型別：農曆</div>'
          : '<div class="text-xs text-gray-600 mt-1">日曆型別：公曆</div>';

        const expiryDate = new Date(subscription.expiryDate);
        const currentDtf = new Intl.DateTimeFormat('en-US', {
          timeZone: globalTimezone,
          hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const currentParts = currentDtf.formatToParts(currentTime);
        const getCurrent = type => Number(currentParts.find(x => x.type === type).value);
        const currentDateInTimezone = Date.UTC(getCurrent('year'), getCurrent('month') - 1, getCurrent('day'), 0, 0, 0);

        const expiryDtf = new Intl.DateTimeFormat('en-US', {
          timeZone: globalTimezone,
          hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const expiryParts = expiryDtf.formatToParts(expiryDate);
        const getExpiry = type => Number(expiryParts.find(x => x.type === type).value);
        const expiryDateInTimezone = Date.UTC(getExpiry('year'), getExpiry('month') - 1, getExpiry('day'), 0, 0, 0);

        const daysDiff = Math.round((expiryDateInTimezone - currentDateInTimezone) / (1000 * 60 * 60 * 24));
        const diffMs = expiryDate.getTime() - currentTime.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        const reminder = getReminderSettings(subscription);
        const isSoon = reminder.unit === 'hour'
          ? diffHours >= 0 && diffHours <= reminder.value
          : daysDiff >= 0 && daysDiff <= reminder.value;

        let statusHtml = '';
        if (!subscription.isActive) {
          statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-gray-500"><i class="fas fa-pause-circle mr-1"></i>已停用</span>';
        } else if (daysDiff < 0) {
          statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-red-500"><i class="fas fa-exclamation-circle mr-1"></i>已過期</span>';
        } else if (isSoon) {
          statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-yellow-500"><i class="fas fa-exclamation-triangle mr-1"></i>即將到期</span>';
        } else {
          statusHtml = '<span class="px-2 py-1 text-xs font-medium rounded-full text-white bg-green-500"><i class="fas fa-check-circle mr-1"></i>正常</span>';
        }

        let periodText = '';
        if (subscription.periodValue && subscription.periodUnit) {
          const unitMap = { day: '天', month: '月', year: '年' };
          periodText = subscription.periodValue + ' ' + (unitMap[subscription.periodUnit] || subscription.periodUnit);
        }

        const autoRenewIcon = subscription.autoRenew !== false
          ? '<i class="fas fa-sync-alt text-blue-500 ml-1" title="自動續訂"></i>'
          : '<i class="fas fa-ban text-gray-400 ml-1" title="不自動續訂"></i>';

        let lunarExpiryText = '';
        let startLunarText = '';
        if (showLunar) {
          const expiryDateObj = new Date(subscription.expiryDate);
          const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
          lunarExpiryText = lunarExpiry ? lunarExpiry.fullStr : '';

          if (subscription.startDate) {
            const startDateObj = new Date(subscription.startDate);
            const lunarStart = lunarCalendar.solar2lunar(startDateObj.getFullYear(), startDateObj.getMonth() + 1, startDateObj.getDate());
            startLunarText = lunarStart ? lunarStart.fullStr : '';
          }
        }

        let notesHtml = '';
        if (subscription.notes) {
          const notes = subscription.notes;
          if (notes.length > 50) {
            const truncatedNotes = notes.substring(0, 50) + '...';
            notesHtml = '<div class="notes-container">' +
              '<div class="notes-text text-xs text-gray-500" data-full-notes="' + notes.replace(/"/g, '&quot;') + '">' +
                truncatedNotes +
              '</div>' +
              '<div class="notes-tooltip"></div>' +
            '</div>';
          } else {
            notesHtml = '<div class="text-xs text-gray-500">' + notes + '</div>';
          }
        }

        const nameHtml = createHoverText(subscription.name, 20, 'text-sm font-medium text-gray-900');
        const typeHtml = createHoverText(subscription.customType || '其他', 15, 'text-sm text-gray-900');
        const periodHtml = periodText ? createHoverText('週期: ' + periodText, 20, 'text-xs text-gray-500 mt-1') : '';

        const categoryTokens = normalizeCategoryTokens(subscription.category);
        const categoryHtml = categoryTokens.length
          ? '<div class="flex flex-wrap gap-2 mt-2">' + categoryTokens.map(cat =>
              '<span class="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-full"><i class="fas fa-tag mr-1"></i>' + cat + '</span>'
            ).join('') + '</div>'
          : '';

        function formatDateInTimezone(date, timezone) {
          return date.toLocaleDateString('zh-CN', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
        }

        const expiryDateText = formatDateInTimezone(new Date(subscription.expiryDate), globalTimezone);
        const lunarHtml = lunarExpiryText ? createHoverText('農曆: ' + lunarExpiryText, 25, 'text-xs text-blue-600 mt-1') : '';

        let daysLeftText = '';
        if (diffMs < 0) {
          const absDays = Math.abs(daysDiff);
          if (absDays >= 1) {
            daysLeftText = '已過期' + absDays + '天';
          } else {
            const absHours = Math.ceil(Math.abs(diffHours));
            daysLeftText = '已過期' + absHours + '小時';
          }
        } else if (daysDiff >= 1) {
          daysLeftText = '還剩' + daysDiff + '天';
        } else {
          const hoursLeft = Math.max(0, Math.ceil(diffHours));
          daysLeftText = hoursLeft > 0 ? '約 ' + hoursLeft + ' 小時後到期' : '即將到期';
        }

        const startDateText = subscription.startDate
          ? '開始: ' + formatDateInTimezone(new Date(subscription.startDate), globalTimezone) + (startLunarText ? ' (' + startLunarText + ')' : '')
          : '';
        const startDateHtml = startDateText ? createHoverText(startDateText, 30, 'text-xs text-gray-500 mt-1') : '';

        const reminderExtra = reminder.value === 0
          ? '<div class="text-xs text-gray-500 mt-1">僅到期時提醒</div>'
          : (reminder.unit === 'hour' ? '<div class="text-xs text-gray-500 mt-1">小時級提醒</div>' : '');
        const reminderHtml = '<div><i class="fas fa-bell mr-1"></i>' + reminder.displayText + '</div>' + reminderExtra;

        row.innerHTML =
          '<td data-label="名稱" class="px-4 py-3"><div class="td-content-wrapper">' +
            nameHtml +
            notesHtml +
          '</div></td>' +
          '<td data-label="型別" class="px-4 py-3"><div class="td-content-wrapper space-y-1">' +
            '<div class="flex items-center gap-1">' +
              '<i class="fas fa-layer-group text-gray-400"></i>' +
              typeHtml +
            '</div>' +
            (periodHtml ? '<div class="flex items-center gap-1">' + periodHtml + autoRenewIcon + '</div>' : '') +
            categoryHtml +
            calendarTypeHtml +
          '</div></td>' +
          '<td data-label="到期時間" class="px-4 py-3"><div class="td-content-wrapper">' +
            '<div class="text-sm text-gray-900">' + expiryDateText + '</div>' +
            lunarHtml +
            '<div class="text-xs text-gray-500 mt-1">' + daysLeftText + '</div>' +
            startDateHtml +
          '</div></td>' +
          '<td data-label="提醒設定" class="px-4 py-3"><div class="td-content-wrapper">' +
            reminderHtml +
          '</div></td>' +
          '<td data-label="狀態" class="px-4 py-3"><div class="td-content-wrapper">' + statusHtml + '</div></td>' +
          '<td data-label="操作" class="px-4 py-3">' +
            '<div class="action-buttons-wrapper">' +
              '<button class="edit btn-primary text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '"><i class="fas fa-edit mr-1"></i>編輯</button>' +
              '<button class="test-notify btn-info text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '"><i class="fas fa-paper-plane mr-1"></i>測試</button>' +
              '<button class="delete btn-danger text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '"><i class="fas fa-trash-alt mr-1"></i>刪除</button>' +
              (subscription.isActive
                ? '<button class="toggle-status btn-warning text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '" data-action="deactivate"><i class="fas fa-pause-circle mr-1"></i>停用</button>'
                : '<button class="toggle-status btn-success text-white px-2 py-1 rounded text-xs whitespace-nowrap" data-id="' + subscription.id + '" data-action="activate"><i class="fas fa-play-circle mr-1"></i>啟用</button>') +
            '</div>' +
          '</td>';

        tbody.appendChild(row);
      });

      document.querySelectorAll('.edit').forEach(button => {
        button.addEventListener('click', editSubscription);
      });

      document.querySelectorAll('.delete').forEach(button => {
        button.addEventListener('click', deleteSubscription);
      });

      document.querySelectorAll('.toggle-status').forEach(button => {
        button.addEventListener('click', toggleSubscriptionStatus);
      });

      document.querySelectorAll('.test-notify').forEach(button => {
        button.addEventListener('click', testSubscriptionNotification);
      });

      attachHoverListeners();
    }

    const searchInput = document.getElementById('searchKeyword');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => renderSubscriptionTable(), 200);
      });
    }

    const categorySelect = document.getElementById('categoryFilter');
    if (categorySelect) {
      categorySelect.addEventListener('change', () => renderSubscriptionTable());
    }

    // 獲取所有訂閱並按到期時間排序
    async function loadSubscriptions(showLoading = true) {
      try {
        const listShowLunar = document.getElementById('listShowLunar');
        const saved = localStorage.getItem('showLunar');
        if (listShowLunar) {
          if (saved !== null) {
            listShowLunar.checked = saved === 'true';
          } else {
            listShowLunar.checked = true;
          }
        }

        const tbody = document.getElementById('subscriptionsBody');
        if (tbody && showLoading) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>載入中...</td></tr>';
        }

        const response = await fetch('/api/subscriptions');
        const data = await response.json();

        subscriptionsCache = Array.isArray(data) ? data : [];
        populateCategoryFilter(subscriptionsCache);
        renderSubscriptionTable();
      } catch (error) {
        console.error('載入訂閱失敗:', error);
        const tbody = document.getElementById('subscriptionsBody');
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>載入失敗，請重新整理頁面重試</td></tr>';
        }
        showToast('載入訂閱列表失敗', 'error');
      }
    }
    
    async function testSubscriptionNotification(e) {
        const button = e.target.tagName === 'BUTTON' ? e.target : e.target.parentElement;
        const id = button.dataset.id;
        const originalContent = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>';
        button.disabled = true;

        try {
            const response = await fetch('/api/subscriptions/' + id + '/test-notify', { method: 'POST' });
            const result = await response.json();
            if (result.success) {
                showToast(result.message || '測試通知已傳送', 'success');
            } else {
                showToast(result.message || '測試通知傳送失敗', 'error');
            }
        } catch (error) {
            console.error('測試通知失敗:', error);
            showToast('傳送測試通知時發生錯誤', 'error');
        } finally {
            button.innerHTML = originalContent;
            button.disabled = false;
        }
    }
    
    async function toggleSubscriptionStatus(e) {
      const id = e.target.dataset.id || e.target.parentElement.dataset.id;
      const action = e.target.dataset.action || e.target.parentElement.dataset.action;
      const isActivate = action === 'activate';
      
      const button = e.target.tagName === 'BUTTON' ? e.target : e.target.parentElement;
      const originalContent = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>' + (isActivate ? '啟用中...' : '停用中...');
      button.disabled = true;
      
      try {
        const response = await fetch('/api/subscriptions/' + id + '/toggle-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: isActivate })
        });
        
        if (response.ok) {
          showToast((isActivate ? '啟用' : '停用') + '成功', 'success');
          loadSubscriptions();
        } else {
          const error = await response.json();
          showToast((isActivate ? '啟用' : '停用') + '失敗: ' + (error.message || '未知錯誤'), 'error');
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        console.error((isActivate ? '啟用' : '停用') + '訂閱失敗:', error);
        showToast((isActivate ? '啟用' : '停用') + '失敗，請稍後再試', 'error');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    document.getElementById('addSubscriptionBtn').addEventListener('click', () => {
      document.getElementById('modalTitle').textContent = '新增新訂閱';
      document.getElementById('subscriptionModal').classList.remove('hidden');

      document.getElementById('subscriptionForm').reset();
      document.getElementById('subscriptionId').value = '';
      clearFieldErrors();

      const today = new Date().toISOString().split('T')[0]; // 前端使用本地時間
      document.getElementById('startDate').value = today;
      document.getElementById('category').value = '';
      document.getElementById('reminderValue').value = '7';
      document.getElementById('reminderUnit').value = 'day';
      document.getElementById('isActive').checked = true;
      document.getElementById('autoRenew').checked = true;

      loadLunarPreference();
      calculateExpiryDate();
      setupModalEventListeners();
    });

    // 自定義日期選擇器功能
    class CustomDatePicker {
      constructor(inputId, pickerId, calendarId, monthId, yearId, prevBtnId, nextBtnId) {
        console.log('CustomDatePicker 建構函式:', { inputId, pickerId, calendarId, monthId, yearId, prevBtnId, nextBtnId });
        
        this.input = document.getElementById(inputId);
        this.picker = document.getElementById(pickerId);
        this.calendar = document.getElementById(calendarId);
        this.monthElement = document.getElementById(monthId);
        this.yearElement = document.getElementById(yearId);
        this.prevBtn = document.getElementById(prevBtnId);
        this.nextBtn = document.getElementById(nextBtnId);
        
        // 新增元素
        this.monthPicker = document.getElementById(pickerId.replace('Picker', 'MonthPicker'));
        this.yearPicker = document.getElementById(pickerId.replace('Picker', 'YearPicker'));
        this.backToCalendarBtn = document.getElementById(pickerId.replace('Picker', 'BackToCalendar'));
        this.backToCalendarFromYearBtn = document.getElementById(pickerId.replace('Picker', 'BackToCalendarFromYear'));
        this.goToTodayBtn = document.getElementById(pickerId.replace('Picker', 'GoToToday'));
        this.prevYearDecadeBtn = document.getElementById(pickerId.replace('Picker', 'PrevYearDecade'));
        this.nextYearDecadeBtn = document.getElementById(pickerId.replace('Picker', 'NextYearDecade'));
        this.yearRangeElement = document.getElementById(pickerId.replace('Picker', 'YearRange'));
        this.yearGrid = document.getElementById(pickerId.replace('Picker', 'YearGrid'));
        
        console.log('找到的元素:', {
          input: !!this.input,
          picker: !!this.picker,
          calendar: !!this.calendar,
          monthElement: !!this.monthElement,
          yearElement: !!this.yearElement,
          prevBtn: !!this.prevBtn,
          nextBtn: !!this.nextBtn
        });
        
        this.currentDate = new Date();
        this.selectedDate = null;
        this.currentView = 'calendar'; // 'calendar', 'month', 'year'
        this.yearDecade = Math.floor(this.currentDate.getFullYear() / 10) * 10;
        
        this.init();
      }
      
      init() {
        console.log('初始化日期選擇器，輸入框:', !!this.input, '選擇器:', !!this.picker);
        
        // 繫結基本事件
        if (this.input) {
          // 移除之前的事件監聽器（如果存在）
          this.input.removeEventListener('click', this._forceShowHandler);
          this._forceShowHandler = () => this.forceShow();
          this.input.addEventListener('click', this._forceShowHandler);
          if (this._manualInputHandler) {
            this.input.removeEventListener('blur', this._manualInputHandler);
          }
          this._manualInputHandler = () => this.syncFromInputValue();
          this.input.addEventListener('blur', this._manualInputHandler);

          if (this._manualKeydownHandler) {
            this.input.removeEventListener('keydown', this._manualKeydownHandler);
          }
          this._manualKeydownHandler = (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              this.syncFromInputValue();
            }
          };
          this.input.addEventListener('keydown', this._manualKeydownHandler);
        }
        
        if (this.prevBtn) {
          this.prevBtn.removeEventListener('click', this._prevHandler);
          this._prevHandler = () => this.previousMonth();
          this.prevBtn.addEventListener('click', this._prevHandler);
        }
        
        if (this.nextBtn) {
          this.nextBtn.removeEventListener('click', this._nextHandler);
          this._nextHandler = () => this.nextMonth();
          this.nextBtn.addEventListener('click', this._nextHandler);
        }
        
        // 繫結月份和年份點選事件
        if (this.monthElement) {
          this.monthElement.removeEventListener('click', this._showMonthHandler);
          this._showMonthHandler = () => this.showMonthPicker();
          this.monthElement.addEventListener('click', this._showMonthHandler);
        }
        
        if (this.yearElement) {
          this.yearElement.removeEventListener('click', this._showYearHandler);
          this._showYearHandler = () => this.showYearPicker();
          this.yearElement.addEventListener('click', this._showYearHandler);
        }
        
        // 繫結月份選擇器事件
        if (this.monthPicker) {
          this.monthPicker.removeEventListener('click', this._monthSelectHandler);
          this._monthSelectHandler = (e) => {
            if (e.target.classList.contains('month-option')) {
              const month = parseInt(e.target.dataset.month);
              this.selectMonth(month);
            }
          };
          this.monthPicker.addEventListener('click', this._monthSelectHandler);
        }
        
        if (this.backToCalendarBtn) {
          this.backToCalendarBtn.removeEventListener('click', this._backToCalendarHandler);
          this._backToCalendarHandler = () => this.showCalendar();
          this.backToCalendarBtn.addEventListener('click', this._backToCalendarHandler);
        }
        
        if (this.backToCalendarFromYearBtn) {
          this.backToCalendarFromYearBtn.removeEventListener('click', this._backToCalendarFromYearHandler);
          this._backToCalendarFromYearHandler = () => this.showCalendar();
          this.backToCalendarFromYearBtn.addEventListener('click', this._backToCalendarFromYearHandler);
        }
        
        // 繫結年份選擇器事件
        if (this.prevYearDecadeBtn) {
        this.prevYearDecadeBtn.removeEventListener('click', this._prevYearDecadeHandler);
        this._prevYearDecadeHandler = (e) => {
            e.stopPropagation(); // 防止事件冒泡到表單
            this.previousYearDecade();
        };
        this.prevYearDecadeBtn.addEventListener('click', this._prevYearDecadeHandler);
        }

        if (this.nextYearDecadeBtn) {
        this.nextYearDecadeBtn.removeEventListener('click', this._nextYearDecadeHandler);
        this._nextYearDecadeHandler = (e) => {
            e.stopPropagation(); // 防止事件冒泡到表單
            this.nextYearDecade();
        };
        this.nextYearDecadeBtn.addEventListener('click', this._nextYearDecadeHandler);
}
        
        // 繫結回到今天事件
        if (this.goToTodayBtn) {
          this.goToTodayBtn.removeEventListener('click', this._goToTodayHandler);
          this._goToTodayHandler = () => this.goToToday();
          this.goToTodayBtn.addEventListener('click', this._goToTodayHandler);
        }
        
        // 點選外部關閉
        if (this._outsideClickHandler) {
          document.removeEventListener('click', this._outsideClickHandler);
        }
        this._outsideClickHandler = (e) => {
          if (this.picker && !this.picker.contains(e.target) && !this.input.contains(e.target)) {
            console.log('點選外部，隱藏日期選擇器');
            this.hide();
          }
        };
        document.addEventListener('click', this._outsideClickHandler);
        
        // 初始化顯示
        this.syncFromInputValue();
        this.render();
        this.renderYearGrid();
      }
      
      toggle() {
        console.log('toggle 被呼叫');
        console.log('picker 元素:', this.picker);
        console.log('picker 類名:', this.picker ? this.picker.className : 'null');
        console.log('是否包含 hidden:', this.picker ? this.picker.classList.contains('hidden') : 'null');
        
        if (this.picker && this.picker.classList.contains('hidden')) {
          console.log('顯示日期選擇器');
          this.show();
        } else {
          console.log('隱藏日期選擇器');
          this.hide();
        }
      }
      
      // 強制顯示日期選擇器
      forceShow() {
        console.log('forceShow 被呼叫');
        if (this.picker) {
          // 確保選擇器顯示
          this.picker.classList.remove('hidden');
          // 重置到日曆檢視
          this.currentView = 'calendar';
          this.hideAllViews();
          this.render();
          console.log('日期選擇器已顯示');
        } else {
          console.error('日期選擇器元素不存在');
        }
      }
      
      show() {
        if (this.picker) {
          this.picker.classList.remove('hidden');
          this.render();
        }
      }
      
      hide() {
        if (this.picker) {
          this.picker.classList.add('hidden');
        }
      }
      
      previousMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        this.render();
      }
      
      nextMonth() {
        this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        this.render();
      }
      
      selectDate(date) {
        this.selectedDate = date;
        if (this.input) {
          // 使用本地時間格式化，避免時區問題
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          this.input.value = year + '-' + month + '-' + day;
        }
        this.hide();
        
        // 觸發change事件，但不冒泡到表單
        if (this.input) {
          const event = new Event('change', { bubbles: false });
          this.input.dispatchEvent(event);
        }
      }

      syncFromInputValue() {
        if (!this.input) {
          return;
        }
        const value = this.input.value.trim();
        if (!value) {
          this.selectedDate = null;
          return;
        }

        const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (!match) {
          if (typeof showToast === 'function') {
            showToast('日期格式需為 YYYY-MM-DD', 'warning');
          }
          return;
        }

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const parsed = new Date(year, month - 1, day);
        if (isNaN(parsed.getTime()) || parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
          if (typeof showToast === 'function') {
            showToast('請輸入有效的日期', 'warning');
          }
          return;
        }

        this.selectedDate = parsed;
        this.currentDate = new Date(parsed);
        this.render();

        const event = new Event('change', { bubbles: false });
        this.input.dispatchEvent(event);
      }
      
      render() {
        if (!this.monthElement || !this.yearElement || !this.calendar) return;
        
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        
        // 更新月份年份顯示
        this.monthElement.textContent = (month + 1) + '月';
        this.yearElement.textContent = year;
        
        // 清空日曆
        this.calendar.innerHTML = '';
        
        // 獲取當月第一天和最後一天
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());
        
        // 生成日曆網格
        for (let i = 0; i < 42; i++) {
          const date = new Date(startDate);
          date.setDate(startDate.getDate() + i);
          
          const dayElement = document.createElement('div');
          dayElement.className = 'calendar-day';
          
          // 判斷是否是當前月份
          if (date.getMonth() !== month) {
            dayElement.classList.add('other-month');
          }
          
          // 判斷是否是今天
          const today = new Date();
          if (date.toDateString() === today.toDateString()) {
            dayElement.classList.add('today');
          }
          
          // 判斷是否是選中日期
          if (this.selectedDate && date.toDateString() === this.selectedDate.toDateString()) {
            dayElement.classList.add('selected');
          }
          
          // 獲取農曆資訊
          let lunarText = '';
          try {
            const lunar = lunarCalendar.solar2lunar(date.getFullYear(), date.getMonth() + 1, date.getDate());
            if (lunar) {
              if (lunar.day === 1) {
                // 初一，只顯示月份
                lunarText = lunar.isLeap ? '閏' + lunar.monthStr.replace('閏', '') : lunar.monthStr;
              } else {
                // 不是初一，顯示日
                lunarText = lunar.dayStr;
              }
            }
          } catch (error) {
            console.error('農曆轉換錯誤:', error);
          }
          
          dayElement.innerHTML =
            '<div>' + date.getDate() + '</div>' +
            '<div class="lunar-text">' + lunarText + '</div>';
          
          dayElement.addEventListener('click', () => this.selectDate(date));
          
          this.calendar.appendChild(dayElement);
        }
      }
      
      // 顯示月份選擇器
      showMonthPicker() {
        this.currentView = 'month';
        this.hideAllViews();
        if (this.monthPicker) {
          this.monthPicker.classList.remove('hidden');
          // 高亮當前月份
          const monthOptions = this.monthPicker.querySelectorAll('.month-option');
          monthOptions.forEach((option, index) => {
            option.classList.remove('selected');
            if (index === this.currentDate.getMonth()) {
              option.classList.add('selected');
            }
          });
        }
      }
      
      // 顯示年份選擇器
      showYearPicker() {
        this.currentView = 'year';
        this.hideAllViews();
        if (this.yearPicker) {
          this.yearPicker.classList.remove('hidden');
        }
        this.renderYearGrid();
      }
      
      // 顯示日曆檢視
      showCalendar() {
        this.currentView = 'calendar';
        this.hideAllViews();
        this.render();
      }
      
      // 隱藏所有檢視
      hideAllViews() {
        if (this.monthPicker) this.monthPicker.classList.add('hidden');
        if (this.yearPicker) this.yearPicker.classList.add('hidden');
        // 注意：不隱藏日曆檢視，因為它是主檢視
      }
      
      // 選擇月份
      selectMonth(month) {
        this.currentDate.setMonth(month);
        this.showCalendar();
      }
      
      // 選擇年份
      selectYear(year) {
        this.currentDate.setFullYear(year);
        this.showCalendar();
      }
      
      // 上一十年
      previousYearDecade() {
        this.yearDecade -= 10;
        this.renderYearGrid();
      }
      
      // 下一十年
      nextYearDecade() {
        this.yearDecade += 10;
        this.renderYearGrid();
      }
      
      // 渲染年份網格
      renderYearGrid() {
        if (!this.yearGrid || !this.yearRangeElement) return;
        
        const startYear = this.yearDecade;
        const endYear = this.yearDecade + 9;
        
        // 更新年份範圍顯示
        this.yearRangeElement.textContent = startYear + '-' + endYear;
        
        // 清空年份網格
        this.yearGrid.innerHTML = '';
        
        // 生成年份按鈕
        for (let year = startYear; year <= endYear; year++) {
          const yearBtn = document.createElement('button');
          yearBtn.type = 'button';
          yearBtn.className = 'year-option px-3 py-2 text-sm rounded hover:bg-gray-100';
          yearBtn.textContent = year;
          yearBtn.dataset.year = year;
          
          // 高亮當前年份
          if (year === this.currentDate.getFullYear()) {
            yearBtn.classList.add('bg-indigo-100', 'text-indigo-600');
          }
          
          // 限制年份範圍 1900-2100
          if (year < 1900 || year > 2100) {
            yearBtn.disabled = true;
            yearBtn.classList.add('opacity-50', 'cursor-not-allowed');
          } else {
            yearBtn.addEventListener('click', () => this.selectYear(year));
          }
          
          this.yearGrid.appendChild(yearBtn);
        }
      }
      
      // 回到今天
      goToToday() {
        this.currentDate = new Date();
        this.yearDecade = Math.floor(this.currentDate.getFullYear() / 10) * 10;
        this.showCalendar();
      }
      
      destroy() {
        this.hide();
        
        // 清理事件監聽器
        if (this.input && this._forceShowHandler) {
          this.input.removeEventListener('click', this._forceShowHandler);
        }
        if (this.input && this._manualInputHandler) {
          this.input.removeEventListener('blur', this._manualInputHandler);
        }
        if (this.input && this._manualKeydownHandler) {
          this.input.removeEventListener('keydown', this._manualKeydownHandler);
        }
        if (this.prevBtn && this._prevHandler) {
          this.prevBtn.removeEventListener('click', this._prevHandler);
        }
        if (this.nextBtn && this._nextHandler) {
          this.nextBtn.removeEventListener('click', this._nextHandler);
        }
        if (this.monthElement && this._showMonthHandler) {
          this.monthElement.removeEventListener('click', this._showMonthHandler);
        }
        if (this.yearElement && this._showYearHandler) {
          this.yearElement.removeEventListener('click', this._showYearHandler);
        }
        if (this.monthPicker && this._monthSelectHandler) {
          this.monthPicker.removeEventListener('click', this._monthSelectHandler);
        }
        if (this.backToCalendarBtn && this._backToCalendarHandler) {
          this.backToCalendarBtn.removeEventListener('click', this._backToCalendarHandler);
        }
        if (this.backToCalendarFromYearBtn && this._backToCalendarFromYearHandler) {
          this.backToCalendarFromYearBtn.removeEventListener('click', this._backToCalendarFromYearHandler);
        }
        if (this.prevYearDecadeBtn && this._prevYearDecadeHandler) {
          this.prevYearDecadeBtn.removeEventListener('click', this._prevYearDecadeHandler);
        }
        if (this.nextYearDecadeBtn && this._nextYearDecadeHandler) {
          this.nextYearDecadeBtn.removeEventListener('click', this._nextYearDecadeHandler);
        }
        if (this.goToTodayBtn && this._goToTodayHandler) {
          this.goToTodayBtn.removeEventListener('click', this._goToTodayHandler);
        }
        if (this._outsideClickHandler) {
          document.removeEventListener('click', this._outsideClickHandler);
        }
      }
    }
    
    function setupModalEventListeners() {
      // 獲取DOM元素
      const calculateExpiryBtn = document.getElementById('calculateExpiryBtn');
      const useLunar = document.getElementById('useLunar');
      const showLunar = document.getElementById('showLunar');
      const startDate = document.getElementById('startDate');
      const expiryDate = document.getElementById('expiryDate');
      const cancelBtn = document.getElementById('cancelBtn');
      
      // 直接繫結事件監聽器（簡化處理，避免重複移除的問題）
      if (calculateExpiryBtn) {
        calculateExpiryBtn.addEventListener('click', calculateExpiryDate);
      }
      if (useLunar) {
        useLunar.addEventListener('change', calculateExpiryDate);
      }
      if (showLunar) {
        showLunar.addEventListener('change', toggleLunarDisplay);
      }
      if (startDate) {
        startDate.addEventListener('change', () => updateLunarDisplay('startDate', 'startDateLunar'));
      }
      if (expiryDate) {
        expiryDate.addEventListener('change', () => updateLunarDisplay('expiryDate', 'expiryDateLunar'));
      }
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          document.getElementById('subscriptionModal').classList.add('hidden');
        });
      }
      // 為週期相關欄位新增事件監聽
      ['startDate', 'periodValue', 'periodUnit'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
          element.addEventListener('change', calculateExpiryDate);
        }
      });

      // 初始化自定義日期選擇器
      try {
        // 安全地清理之前的例項
        if (window.startDatePicker && typeof window.startDatePicker.destroy === 'function') {
          window.startDatePicker.destroy();
        }
        if (window.expiryDatePicker && typeof window.expiryDatePicker.destroy === 'function') {
          window.expiryDatePicker.destroy();
        }
        
        // 清理全域性變數
        window.startDatePicker = null;
        window.expiryDatePicker = null;
        
        // 確保DOM元素存在後再建立選擇器
        setTimeout(() => {
          console.log('建立開始日期選擇器...');
          window.startDatePicker = new CustomDatePicker(
            'startDate', 'startDatePicker', 'startDateCalendar', 
            'startDateMonth', 'startDateYear', 'startDatePrevMonth', 'startDateNextMonth'
          );
          
          console.log('建立到期日期選擇器...');
          window.expiryDatePicker = new CustomDatePicker(
            'expiryDate', 'expiryDatePicker', 'expiryDateCalendar', 
            'expiryDateMonth', 'expiryDateYear', 'expiryDatePrevMonth', 'expiryDateNextMonth'
          );
          
          console.log('日期選擇器初始化完成');
        }, 50);
      } catch (error) {
        console.error('初始化日期選擇器失敗:', error);
        // 確保清理失敗的例項
        window.startDatePicker = null;
        window.expiryDatePicker = null;
      }
    }

	// 3. 新增修改， calculateExpiryDate 函式，支援農曆週期推算     
	function calculateExpiryDate() {
	  const startDate = document.getElementById('startDate').value;
	  const periodValue = parseInt(document.getElementById('periodValue').value);
	  const periodUnit = document.getElementById('periodUnit').value;
	  const useLunar = document.getElementById('useLunar').checked;

	  if (!startDate || !periodValue || !periodUnit) {
		return;
	  }

	  if (useLunar) {
		// 農曆推算
		const start = new Date(startDate);
		const lunar = lunarCalendar.solar2lunar(start.getFullYear(), start.getMonth() + 1, start.getDate());
		let nextLunar = addLunarPeriod(lunar, periodValue, periodUnit);
		const solar = lunar2solar(nextLunar);
		
		// 使用與公曆相同的方式建立日期  
		const expiry = new Date(startDate); // 從原始日期開始  
		expiry.setFullYear(solar.year);  
		expiry.setMonth(solar.month - 1);  
		expiry.setDate(solar.day);  
		document.getElementById('expiryDate').value = expiry.toISOString().split('T')[0];
		console.log('start:', start);
		console.log('nextLunar:', nextLunar);
		console.log('expiry:', expiry);
		console.log('expiryDate:', document.getElementById('expiryDate').value);
		
		console.log('solar from lunar2solar:', solar);  
		console.log('solar.year:', solar.year, 'solar.month:', solar.month, 'solar.day:', solar.day);
		console.log('expiry.getTime():', expiry.getTime());  
		console.log('expiry.toString():', expiry.toString());
		
		
	  } else {
		// 公曆推算
		const start = new Date(startDate);
		const expiry = new Date(start);
		if (periodUnit === 'day') {
		  expiry.setDate(start.getDate() + periodValue);
		} else if (periodUnit === 'month') {
		  expiry.setMonth(start.getMonth() + periodValue);
		} else if (periodUnit === 'year') {
		  expiry.setFullYear(start.getFullYear() + periodValue);
		}
		document.getElementById('expiryDate').value = expiry.toISOString().split('T')[0];
		console.log('start:', start);
		console.log('expiry:', expiry);
		console.log('expiryDate:', document.getElementById('expiryDate').value);
	  }

	  // 更新農曆顯示
	  updateLunarDisplay('startDate', 'startDateLunar');
	  updateLunarDisplay('expiryDate', 'expiryDateLunar');
	}
    
    document.getElementById('closeModal').addEventListener('click', () => {
      document.getElementById('subscriptionModal').classList.add('hidden');
    });
    
    // 禁止點選彈窗外區域關閉彈窗，防止誤操作丟失內容
    // document.getElementById('subscriptionModal').addEventListener('click', (event) => {
    //   if (event.target === document.getElementById('subscriptionModal')) {
    //     document.getElementById('subscriptionModal').classList.add('hidden');
    //   }
    // });
    
	
	// 4. 新增修改，監聽 useLunar 複選框變化時也自動重新計算
	// 注意：這個事件監聽器已經在 setupModalEventListeners 中處理了   
   // 新增修改，表單提交時帶上 useLunar 欄位
    document.getElementById('subscriptionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!validateForm()) {
        return;
      }
      
      const id = document.getElementById('subscriptionId').value;
      const reminderUnit = document.getElementById('reminderUnit').value;
      const reminderValue = Number(document.getElementById('reminderValue').value) || 0;

      const subscription = {
        name: document.getElementById('name').value.trim(),
        customType: document.getElementById('customType').value.trim(),
        category: document.getElementById('category').value.trim(),
        notes: document.getElementById('notes').value.trim() || '',
        isActive: document.getElementById('isActive').checked,
        autoRenew: document.getElementById('autoRenew').checked,
        startDate: document.getElementById('startDate').value,
        expiryDate: document.getElementById('expiryDate').value,
        periodValue: Number(document.getElementById('periodValue').value),
        periodUnit: document.getElementById('periodUnit').value,
        reminderUnit: reminderUnit,
        reminderValue: reminderValue,
        reminderDays: reminderUnit === 'day' ? reminderValue : 0,
        reminderHours: reminderUnit === 'hour' ? reminderValue : undefined,
        useLunar: document.getElementById('useLunar').checked
      };
      
      const submitButton = e.target.querySelector('button[type="submit"]');
      const originalContent = submitButton.innerHTML;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>' + (id ? '更新中...' : '儲存中...');
      submitButton.disabled = true;
      
      try {
        const url = id ? '/api/subscriptions/' + id : '/api/subscriptions';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
          method: method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription)
        });
        
        const result = await response.json();
        
        if (result.success) {
          showToast((id ? '更新' : '新增') + '訂閱成功', 'success');
          document.getElementById('subscriptionModal').classList.add('hidden');
          loadSubscriptions();
        } else {
          showToast((id ? '更新' : '新增') + '訂閱失敗: ' + (result.message || '未知錯誤'), 'error');
        }
      } catch (error) {
        console.error((id ? '更新' : '新增') + '訂閱失敗:', error);
        showToast((id ? '更新' : '新增') + '訂閱失敗，請稍後再試', 'error');
      } finally {
        submitButton.innerHTML = originalContent;
        submitButton.disabled = false;
      }
    });
    
	    // 新增修改，編輯訂閱時回顯 useLunar 欄位
    async function editSubscription(e) {
      const id = e.target.dataset.id || e.target.parentElement.dataset.id;
      
      try {
        const response = await fetch('/api/subscriptions/' + id);
        const subscription = await response.json();
        
        if (subscription) {
          document.getElementById('modalTitle').textContent = '編輯訂閱';
          document.getElementById('subscriptionId').value = subscription.id;
          document.getElementById('name').value = subscription.name;
          document.getElementById('customType').value = subscription.customType || '';
          document.getElementById('category').value = subscription.category || '';
          document.getElementById('notes').value = subscription.notes || '';
          document.getElementById('isActive').checked = subscription.isActive !== false;
          document.getElementById('autoRenew').checked = subscription.autoRenew !== false;
          document.getElementById('startDate').value = subscription.startDate ? subscription.startDate.split('T')[0] : '';
          document.getElementById('expiryDate').value = subscription.expiryDate ? subscription.expiryDate.split('T')[0] : '';
          document.getElementById('periodValue').value = subscription.periodValue || 1;
          document.getElementById('periodUnit').value = subscription.periodUnit || 'month';
          const reminderUnit = subscription.reminderUnit || (subscription.reminderHours !== undefined ? 'hour' : 'day');
          let reminderValue;
          if (reminderUnit === 'hour') {
            if (subscription.reminderValue !== undefined && subscription.reminderValue !== null) {
              reminderValue = subscription.reminderValue;
            } else if (subscription.reminderHours !== undefined) {
              reminderValue = subscription.reminderHours;
            } else {
              reminderValue = 0;
            }
          } else {
            if (subscription.reminderValue !== undefined && subscription.reminderValue !== null) {
              reminderValue = subscription.reminderValue;
            } else if (subscription.reminderDays !== undefined) {
              reminderValue = subscription.reminderDays;
            } else {
              reminderValue = 7;
            }
          }
          document.getElementById('reminderUnit').value = reminderUnit;
          document.getElementById('reminderValue').value = reminderValue;
          document.getElementById('useLunar').checked = !!subscription.useLunar;
          
          clearFieldErrors();
          loadLunarPreference();
          document.getElementById('subscriptionModal').classList.remove('hidden');
          
          // 重要：編輯訂閱時也需要重新設定事件監聽器
          setupModalEventListeners();

          // 更新農曆顯示
          setTimeout(() => {
            updateLunarDisplay('startDate', 'startDateLunar');
            updateLunarDisplay('expiryDate', 'expiryDateLunar');
          }, 100);
        }
      } catch (error) {
        console.error('獲取訂閱資訊失敗:', error);
        showToast('獲取訂閱資訊失敗', 'error');
      }
    }
    
    async function deleteSubscription(e) {
      const id = e.target.dataset.id || e.target.parentElement.dataset.id;
      
      if (!confirm('確定要刪除這個訂閱嗎？此操作不可恢復。')) {
        return;
      }
      
      const button = e.target.tagName === 'BUTTON' ? e.target : e.target.parentElement;
      const originalContent = button.innerHTML;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>刪除中...';
      button.disabled = true;
      
      try {
        const response = await fetch('/api/subscriptions/' + id, {
          method: 'DELETE'
        });
        
        if (response.ok) {
          showToast('刪除成功', 'success');
          loadSubscriptions();
        } else {
          const error = await response.json();
          showToast('刪除失敗: ' + (error.message || '未知錯誤'), 'error');
          button.innerHTML = originalContent;
          button.disabled = false;
        }
      } catch (error) {
        console.error('刪除訂閱失敗:', error);
        showToast('刪除失敗，請稍後再試', 'error');
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    // 全域性時區配置
    let globalTimezone = 'UTC';
    
    // 檢測時區更新
    function checkTimezoneUpdate() {
      const lastUpdate = localStorage.getItem('timezoneUpdated');
      if (lastUpdate) {
        const updateTime = parseInt(lastUpdate);
        const currentTime = Date.now();
        // 如果時區更新發生在最近5秒內，則重新整理頁面
        if (currentTime - updateTime < 5000) {
          localStorage.removeItem('timezoneUpdated');
          window.location.reload();
        }
      }
    }
    
    // 頁面載入時檢查時區更新
    window.addEventListener('load', () => {
      checkTimezoneUpdate();
      loadSubscriptions();
    });
    
    // 定期檢查時區更新（每2秒檢查一次）
    setInterval(checkTimezoneUpdate, 2000);

    // 即時顯示系統時間和時區
    async function showSystemTime() {
      try {
        // 獲取後臺配置的時區
        const response = await fetch('/api/config');
        const config = await response.json();
        globalTimezone = config.TIMEZONE || 'UTC';
        
        // 格式化當前時間
        function formatTime(dt, tz) {
          return dt.toLocaleString('zh-CN', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        function formatTimezoneDisplay(tz) {
          try {
            // 使用更準確的時區偏移計算方法
            const now = new Date();
            const dtf = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              hour12: false,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const parts = dtf.formatToParts(now);
            const get = type => Number(parts.find(x => x.type === type).value);
            const target = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
            const utc = now.getTime();
            const offset = Math.round((target - utc) / (1000 * 60 * 60));
            
            // 時區中文名稱對映
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
            
            const offsetStr = offset >= 0 ? '+' + offset : offset;
            const timezoneName = timezoneNames[tz] || tz;
            return timezoneName + ' (UTC' + offsetStr + ')';
          } catch (error) {
            console.error('格式化時區顯示失敗:', error);
            return tz;
          }
        }
        function update() {
          const now = new Date();
          const timeStr = formatTime(now, globalTimezone);
          const tzStr = formatTimezoneDisplay(globalTimezone);
          const el = document.getElementById('systemTimeDisplay');
          if (el) {
            el.textContent = timeStr + '  ' + tzStr;
          }
        }
        update();
        // 每秒重新整理
        setInterval(update, 1000);
        
        // 定期檢查時區變化並重新載入訂閱列表（每30秒檢查一次）
        setInterval(async () => {
          try {
            const response = await fetch('/api/config');
            const config = await response.json();
            const newTimezone = config.TIMEZONE || 'UTC';
            
            if (globalTimezone !== newTimezone) {
              globalTimezone = newTimezone;
              console.log('時區已更新為:', globalTimezone);
              // 重新載入訂閱列表以更新天數計算
              loadSubscriptions();
            }
          } catch (error) {
            console.error('檢查時區更新失敗:', error);
          }
        }, 30000);
        
        // 初始載入訂閱列表
        loadSubscriptions();
      } catch (e) {
        // 出錯時顯示本地時間
        const el = document.getElementById('systemTimeDisplay');
        if (el) {
          el.textContent = new Date().toLocaleString();
        }
      }
    }
    showSystemTime();
  </script>
</body>
</html>
`;

const configPage = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>系統配置 - 訂閱管理系統</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" rel="stylesheet">
  <style>
    .btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: all 0.3s; }
    .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    .btn-secondary { background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%); transition: all 0.3s; }
    .btn-secondary:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1); }
    
    .toast {
      position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px;
      color: white; font-weight: 500; z-index: 1000; transform: translateX(400px);
      transition: all 0.3s ease-in-out; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .toast.show { transform: translateX(0); }
    .toast.success { background-color: #10b981; }
    .toast.error { background-color: #ef4444; }
    .toast.info { background-color: #3b82f6; }
    .toast.warning { background-color: #f59e0b; }
    
    .config-section { 
      border: 1px solid #e5e7eb; 
      border-radius: 8px; 
      padding: 16px; 
      margin-bottom: 24px; 
    }
    .config-section.active { 
      background-color: #f8fafc; 
      border-color: #6366f1; 
    }
    .config-section.inactive { 
      background-color: #f9fafb; 
      opacity: 0.7; 
    }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div id="toast-container"></div>

  <nav class="bg-white shadow-md">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between h-16">
        <div class="flex items-center">
          <i class="fas fa-calendar-check text-indigo-600 text-2xl mr-2"></i>
          <span class="font-bold text-xl text-gray-800">訂閱管理系統</span>
          <span id="systemTimeDisplay" class="ml-4 text-base text-indigo-600 font-normal"></span>
        </div>
        <div class="flex items-center space-x-4">
          <a href="/admin" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-list mr-1"></i>訂閱列表
          </a>
          <a href="/admin/config" class="text-indigo-600 border-b-2 border-indigo-600 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-cog mr-1"></i>系統配置
          </a>
          <a href="/api/logout" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-sign-out-alt mr-1"></i>退出登入
          </a>
        </div>
      </div>
    </div>
  </nav>
  
  <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="bg-white rounded-lg shadow-md p-6">
      <h2 class="text-2xl font-bold text-gray-800 mb-6">系統配置</h2>
      
      <form id="configForm" class="space-y-8">
        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">管理員賬戶</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label for="adminUsername" class="block text-sm font-medium text-gray-700">使用者名稱</label>
              <input type="text" id="adminUsername" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
            </div>
            <div>
              <label for="adminPassword" class="block text-sm font-medium text-gray-700">密碼</label>
              <input type="password" id="adminPassword" placeholder="如不修改密碼，請留空" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <p class="mt-1 text-sm text-gray-500">留空表示不修改當前密碼</p>
            </div>
          </div>
        </div>
        
        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">顯示設定</h3>
          
          
          <div class="mb-6">
            <label class="inline-flex items-center">
              <input type="checkbox" id="showLunarGlobal" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
              <span class="ml-2 text-sm text-gray-700">在通知中顯示農曆日期</span>
            </label>
            <p class="mt-1 text-sm text-gray-500">控制是否在通知訊息中包含農曆日期資訊</p>
          </div>
        </div>


        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">時區設定</h3>
          <div class="mb-6">
          <label for="timezone" class="block text-sm font-medium text-gray-700 mb-1">時區選擇</label>
          <select id="timezone" name="timezone" class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 bg-white">
            <option value="UTC">世界標準時間（UTC+0）</option>
            <option value="Asia/Shanghai">中國標準時間（UTC+8）</option>
            <option value="Asia/Hong_Kong">香港時間（UTC+8）</option>
            <option value="Asia/Taipei">臺北時間（UTC+8）</option>
            <option value="Asia/Singapore">新加坡時間（UTC+8）</option>
            <option value="Asia/Tokyo">日本時間（UTC+9）</option>
            <option value="Asia/Seoul">韓國時間（UTC+9）</option>
            <option value="America/New_York">美國東部時間（UTC-5）</option>
            <option value="America/Chicago">美國中部時間（UTC-6）</option>
            <option value="America/Denver">美國山地時間（UTC-7）</option>
            <option value="America/Los_Angeles">美國太平洋時間（UTC-8）</option>
            <option value="Europe/London">英國時間（UTC+0）</option>
            <option value="Europe/Paris">巴黎時間（UTC+1）</option>
            <option value="Europe/Berlin">柏林時間（UTC+1）</option>
            <option value="Europe/Moscow">莫斯科時間（UTC+3）</option>
            <option value="Australia/Sydney">悉尼時間（UTC+10）</option>
            <option value="Australia/Melbourne">墨爾本時間（UTC+10）</option>
            <option value="Pacific/Auckland">奧克蘭時間（UTC+12）</option>
          </select>
            <p class="mt-1 text-sm text-gray-500">選擇需要使用時區，系統會按該時區計算剩餘時間（提醒 Cron 仍基於 UTC，請在 Cloudflare 控制檯換算觸發時間）</p>
          </div>
        </div>

        
        <div class="border-b border-gray-200 pb-6">
          <h3 class="text-lg font-medium text-gray-900 mb-4">通知設定</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label for="notificationHours" class="block text-sm font-medium text-gray-700">通知時段（UTC）</label>
              <input type="text" id="notificationHours" placeholder="例如：08, 12, 20 或輸入 * 表示全天"
                class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <p class="mt-1 text-sm text-gray-500">可輸入多個小時，使用逗號或空格分隔；留空則預設每天執行一次任務即可</p>
            </div>
            <div class="bg-indigo-50 border border-indigo-100 rounded-md p-3 text-sm text-indigo-700">
              <p class="font-medium mb-1">提示</p>
              <p>Cloudflare Workers Cron 以 UTC 計算，例如北京時間 08:00 需設定 Cron 為 <code>0 0 * * *</code> 並在此填入 08。</p>
              <p class="mt-1">若 Cron 已設定為每小時執行，可用該欄位限制實際傳送提醒的小時段。</p>
            </div>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-3">通知方式（可多選）</label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="telegram" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">Telegram</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="notifyx" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
                <span class="ml-2 text-sm text-gray-700 font-semibold">NotifyX</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="webhook" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">Webhook 通知</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="wechatbot" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">企業微信機器人</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="email" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">郵件通知</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" name="enabledNotifiers" value="bark" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                <span class="ml-2 text-sm text-gray-700">Bark</span>
              </label>
            </div>
            <div class="mt-2 flex flex-wrap gap-4">
              <a href="https://www.notifyx.cn/" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> NotifyX官網
              </a>
              <a href="https://webhook.site" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> Webhook 除錯工具
              </a>
              <a href="https://developer.work.weixin.qq.com/document/path/91770" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> 企業微信機器人文件
              </a>
              <a href="https://developers.cloudflare.com/workers/tutorials/send-emails-with-resend/" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> 獲取 Resend API Key
              </a>
              <a href="https://apps.apple.com/cn/app/bark-customed-notifications/id1403753865" target="_blank" class="text-indigo-600 hover:text-indigo-800 text-sm">
                <i class="fas fa-external-link-alt ml-1"></i> Bark iOS應用
              </a>
            </div>
          </div>

          <div class="mb-6">
            <label for="thirdPartyToken" class="block text-sm font-medium text-gray-700">第三方 API 訪問令牌</label>
            <div class="mt-1 flex flex-col sm:flex-row sm:items-center gap-3">
              <input type="text" id="thirdPartyToken" placeholder="建議使用隨機字串，例如：iH5s9vB3..."
                class="flex-1 border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <button type="button" id="generateThirdPartyToken" class="btn-info text-white px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap">
                <i class="fas fa-magic mr-2"></i>生成令牌
              </button>
            </div>
            <p class="mt-1 text-sm text-gray-500">呼叫 /api/notify/{token} 介面時需攜帶此令牌；留空表示停用第三方 API 推送。</p>
          </div>
          
          <div id="telegramConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">Telegram 配置</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label for="tgBotToken" class="block text-sm font-medium text-gray-700">Bot Token</label>
                <input type="text" id="tgBotToken" placeholder="從 @BotFather 獲取" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              </div>
              <div>
                <label for="tgChatId" class="block text-sm font-medium text-gray-700">Chat ID</label>
                <input type="text" id="tgChatId" placeholder="可從 @userinfobot 獲取" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testTelegramBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>測試 Telegram 通知
              </button>
            </div>
          </div>
          
          <div id="notifyxConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">NotifyX 配置</h4>
            <div class="mb-4">
              <label for="notifyxApiKey" class="block text-sm font-medium text-gray-700">API Key</label>
              <input type="text" id="notifyxApiKey" placeholder="從 NotifyX 平臺獲取的 API Key" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              <p class="mt-1 text-sm text-gray-500">從 <a href="https://www.notifyx.cn/" target="_blank" class="text-indigo-600 hover:text-indigo-800">NotifyX平臺</a> 獲取的 API Key</p>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testNotifyXBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>測試 NotifyX 通知
              </button>
            </div>
          </div>

          <div id="webhookConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">Webhook 通知 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="webhookUrl" class="block text-sm font-medium text-gray-700">Webhook 通知 URL</label>
                <input type="url" id="webhookUrl" placeholder="https://your-webhook-endpoint.com/path" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">請填寫自建服務或第三方平臺提供的 Webhook 地址，例如 <code>https://your-webhook-endpoint.com/path</code></p>
              </div>
              <div>
                <label for="webhookMethod" class="block text-sm font-medium text-gray-700">請求方法</label>
                <select id="webhookMethod" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                </select>
              </div>
              <div>
                <label for="webhookHeaders" class="block text-sm font-medium text-gray-700">自定義請求頭 (JSON格式，可選)</label>
                <textarea id="webhookHeaders" rows="3" placeholder='{"Authorization": "Bearer your-token", "Content-Type": "application/json"}' class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"></textarea>
                <p class="mt-1 text-sm text-gray-500">JSON格式的自定義請求頭，留空使用預設</p>
              </div>
              <div>
                <label for="webhookTemplate" class="block text-sm font-medium text-gray-700">訊息模板 (JSON格式，可選)</label>
                <textarea id="webhookTemplate" rows="4" placeholder='{"title": "{{title}}", "content": "{{content}}", "timestamp": "{{timestamp}}"}' class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"></textarea>
                <p class="mt-1 text-sm text-gray-500">支援變數: {{title}}, {{content}}, {{timestamp}}。留空使用預設格式</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testWebhookBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>測試 Webhook 通知
              </button>
            </div>
          </div>

          <div id="wechatbotConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">企業微信機器人 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="wechatbotWebhook" class="block text-sm font-medium text-gray-700">機器人 Webhook URL</label>
                <input type="url" id="wechatbotWebhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your-key" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">從企業微信群聊中新增機器人獲取的 Webhook URL</p>
              </div>
              <div>
                <label for="wechatbotMsgType" class="block text-sm font-medium text-gray-700">訊息型別</label>
                <select id="wechatbotMsgType" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                  <option value="text">文字訊息</option>
                  <option value="markdown">Markdown訊息</option>
                </select>
                <p class="mt-1 text-sm text-gray-500">選擇傳送的訊息格式型別</p>
              </div>
              <div>
                <label for="wechatbotAtMobiles" class="block text-sm font-medium text-gray-700">@手機號 (可選)</label>
                <input type="text" id="wechatbotAtMobiles" placeholder="13800138000,13900139000" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">需要@的手機號，多個用逗號分隔，留空則不@任何人</p>
              </div>
              <div>
                <label for="wechatbotAtAll" class="block text-sm font-medium text-gray-700 mb-2">@所有人</label>
                <label class="inline-flex items-center">
                  <input type="checkbox" id="wechatbotAtAll" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                  <span class="ml-2 text-sm text-gray-700">傳送訊息時@所有人</span>
                </label>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testWechatBotBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>測試 企業微信機器人
              </button>
            </div>
          </div>

          <div id="emailConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">郵件通知 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="resendApiKey" class="block text-sm font-medium text-gray-700">Resend API Key</label>
                <input type="text" id="resendApiKey" placeholder="re_xxxxxxxxxx" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">從 <a href="https://resend.com/api-keys" target="_blank" class="text-indigo-600 hover:text-indigo-800">Resend控制檯</a> 獲取的 API Key</p>
              </div>
              <div>
                <label for="emailFrom" class="block text-sm font-medium text-gray-700">發件人郵箱</label>
                <input type="email" id="emailFrom" placeholder="noreply@yourdomain.com" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">必須是已在Resend驗證的域名郵箱</p>
              </div>
              <div>
                <label for="emailFromName" class="block text-sm font-medium text-gray-700">發件人名稱</label>
                <input type="text" id="emailFromName" placeholder="訂閱提醒系統" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">顯示在郵件中的發件人名稱</p>
              </div>
              <div>
                <label for="emailTo" class="block text-sm font-medium text-gray-700">收件人郵箱</label>
                <input type="email" id="emailTo" placeholder="user@example.com" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">接收通知郵件的郵箱地址</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testEmailBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>測試 郵件通知
              </button>
            </div>
          </div>

          <div id="barkConfig" class="config-section">
            <h4 class="text-md font-medium text-gray-900 mb-3">Bark 配置</h4>
            <div class="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label for="barkServer" class="block text-sm font-medium text-gray-700">伺服器地址</label>
                <input type="url" id="barkServer" placeholder="https://api.day.app" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">Bark 伺服器地址，預設為官方伺服器，也可以使用自建伺服器</p>
              </div>
              <div>
                <label for="barkDeviceKey" class="block text-sm font-medium text-gray-700">裝置Key</label>
                <input type="text" id="barkDeviceKey" placeholder="從Bark應用獲取的裝置Key" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <p class="mt-1 text-sm text-gray-500">從 <a href="https://apps.apple.com/cn/app/bark-customed-notifications/id1403753865" target="_blank" class="text-indigo-600 hover:text-indigo-800">Bark iOS 應用</a> 中獲取的裝置Key</p>
              </div>
              <div>
                <label for="barkIsArchive" class="block text-sm font-medium text-gray-700 mb-2">儲存推送</label>
                <label class="inline-flex items-center">
                  <input type="checkbox" id="barkIsArchive" class="form-checkbox h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                  <span class="ml-2 text-sm text-gray-700">儲存推送到歷史記錄</span>
                </label>
                <p class="mt-1 text-sm text-gray-500">勾選後推送訊息會儲存到 Bark 的歷史記錄中</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" id="testBarkBtn" class="btn-secondary text-white px-4 py-2 rounded-md text-sm font-medium">
                <i class="fas fa-paper-plane mr-2"></i>測試 Bark 通知
              </button>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <button type="submit" class="btn-primary text-white px-6 py-2 rounded-md text-sm font-medium">
            <i class="fas fa-save mr-2"></i>儲存配置
          </button>
        </div>
      </form>
    </div>
  </div>

  <script>
    function showToast(message, type = 'success', duration = 3000) {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      
      const icon = type === 'success' ? 'check-circle' :
                   type === 'error' ? 'exclamation-circle' :
                   type === 'warning' ? 'exclamation-triangle' : 'info-circle';
      
      toast.innerHTML = '<div class="flex items-center"><i class="fas fa-' + icon + ' mr-2"></i><span>' + message + '</span></div>';
      
      container.appendChild(toast);
      setTimeout(() => toast.classList.add('show'), 100);
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          if (container.contains(toast)) {
            container.removeChild(toast);
          }
        }, 300);
      }, duration);
    }

    async function loadConfig() {
      try {
        const response = await fetch('/api/config');
        const config = await response.json();

        document.getElementById('adminUsername').value = config.ADMIN_USERNAME || '';
        document.getElementById('tgBotToken').value = config.TG_BOT_TOKEN || '';
        document.getElementById('tgChatId').value = config.TG_CHAT_ID || '';
        document.getElementById('notifyxApiKey').value = config.NOTIFYX_API_KEY || '';
        document.getElementById('webhookUrl').value = config.WEBHOOK_URL || '';
        document.getElementById('webhookMethod').value = config.WEBHOOK_METHOD || 'POST';
        document.getElementById('webhookHeaders').value = config.WEBHOOK_HEADERS || '';
        document.getElementById('webhookTemplate').value = config.WEBHOOK_TEMPLATE || '';
        document.getElementById('wechatbotWebhook').value = config.WECHATBOT_WEBHOOK || '';
        document.getElementById('wechatbotMsgType').value = config.WECHATBOT_MSG_TYPE || 'text';
        document.getElementById('wechatbotAtMobiles').value = config.WECHATBOT_AT_MOBILES || '';
        document.getElementById('wechatbotAtAll').checked = config.WECHATBOT_AT_ALL === 'true';
        document.getElementById('resendApiKey').value = config.RESEND_API_KEY || '';
        document.getElementById('emailFrom').value = config.EMAIL_FROM || '';
        document.getElementById('emailFromName').value = config.EMAIL_FROM_NAME || '訂閱提醒系統';
        document.getElementById('emailTo').value = config.EMAIL_TO || '';
        document.getElementById('barkServer').value = config.BARK_SERVER || 'https://api.day.app';
        document.getElementById('barkDeviceKey').value = config.BARK_DEVICE_KEY || '';
        document.getElementById('barkIsArchive').checked = config.BARK_IS_ARCHIVE === 'true';
        document.getElementById('thirdPartyToken').value = config.THIRD_PARTY_API_TOKEN || '';
        const notificationHoursInput = document.getElementById('notificationHours');
        if (notificationHoursInput) {
          // 將通知小時陣列格式化為逗號分隔的字串，便於管理員檢視與編輯
          const hours = Array.isArray(config.NOTIFICATION_HOURS) ? config.NOTIFICATION_HOURS : [];
          notificationHoursInput.value = hours.join(', ');
        }
        
        // 載入農曆顯示設定
        document.getElementById('showLunarGlobal').checked = config.SHOW_LUNAR === true;

        // 動態生成時區選項，並設定儲存的值
        generateTimezoneOptions(config.TIMEZONE || 'UTC');

        // 處理多選通知渠道
        const enabledNotifiers = config.ENABLED_NOTIFIERS || ['notifyx'];
        document.querySelectorAll('input[name="enabledNotifiers"]').forEach(checkbox => {
          checkbox.checked = enabledNotifiers.includes(checkbox.value);
        });

        toggleNotificationConfigs(enabledNotifiers);
      } catch (error) {
        console.error('載入配置失敗:', error);
        showToast('載入配置失敗，請重新整理頁面重試', 'error');
      }
    }
    
    // 動態生成時區選項
    function generateTimezoneOptions(selectedTimezone = 'UTC') {
      const timezoneSelect = document.getElementById('timezone');
      
      const timezones = [
        { value: 'UTC', name: '世界標準時間', offset: '+0' },
        { value: 'Asia/Shanghai', name: '中國標準時間', offset: '+8' },
        { value: 'Asia/Hong_Kong', name: '香港時間', offset: '+8' },
        { value: 'Asia/Taipei', name: '臺北時間', offset: '+8' },
        { value: 'Asia/Singapore', name: '新加坡時間', offset: '+8' },
        { value: 'Asia/Tokyo', name: '日本時間', offset: '+9' },
        { value: 'Asia/Seoul', name: '韓國時間', offset: '+9' },
        { value: 'America/New_York', name: '美國東部時間', offset: '-5' },
        { value: 'America/Chicago', name: '美國中部時間', offset: '-6' },
        { value: 'America/Denver', name: '美國山地時間', offset: '-7' },
        { value: 'America/Los_Angeles', name: '美國太平洋時間', offset: '-8' },
        { value: 'Europe/London', name: '英國時間', offset: '+0' },
        { value: 'Europe/Paris', name: '巴黎時間', offset: '+1' },
        { value: 'Europe/Berlin', name: '柏林時間', offset: '+1' },
        { value: 'Europe/Moscow', name: '莫斯科時間', offset: '+3' },
        { value: 'Australia/Sydney', name: '悉尼時間', offset: '+10' },
        { value: 'Australia/Melbourne', name: '墨爾本時間', offset: '+10' },
        { value: 'Pacific/Auckland', name: '奧克蘭時間', offset: '+12' }
      ];
      
      // 清空現有選項
      timezoneSelect.innerHTML = '';
      
      // 新增新選項
      timezones.forEach(tz => {
        const option = document.createElement('option');
        option.value = tz.value;
        option.textContent = tz.name + '（UTC' + tz.offset + '）';
        timezoneSelect.appendChild(option);
      });
      
      // 設定選中的時區
      timezoneSelect.value = selectedTimezone;
    }
    
    function toggleNotificationConfigs(enabledNotifiers) {
      const telegramConfig = document.getElementById('telegramConfig');
      const notifyxConfig = document.getElementById('notifyxConfig');
      const webhookConfig = document.getElementById('webhookConfig');
      const wechatbotConfig = document.getElementById('wechatbotConfig');
      const emailConfig = document.getElementById('emailConfig');
      const barkConfig = document.getElementById('barkConfig');

      // 重置所有配置區域
      [telegramConfig, notifyxConfig, webhookConfig, wechatbotConfig, emailConfig, barkConfig].forEach(config => {
        config.classList.remove('active', 'inactive');
        config.classList.add('inactive');
      });

      // 啟用選中的配置區域
      enabledNotifiers.forEach(type => {
        if (type === 'telegram') {
          telegramConfig.classList.remove('inactive');
          telegramConfig.classList.add('active');
        } else if (type === 'notifyx') {
          notifyxConfig.classList.remove('inactive');
          notifyxConfig.classList.add('active');
        } else if (type === 'webhook') {
          webhookConfig.classList.remove('inactive');
          webhookConfig.classList.add('active');
        } else if (type === 'wechatbot') {
          wechatbotConfig.classList.remove('inactive');
          wechatbotConfig.classList.add('active');
        } else if (type === 'email') {
          emailConfig.classList.remove('inactive');
          emailConfig.classList.add('active');
        } else if (type === 'bark') {
          barkConfig.classList.remove('inactive');
          barkConfig.classList.add('active');
        }
      });
    }

    document.querySelectorAll('input[name="enabledNotifiers"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const enabledNotifiers = Array.from(document.querySelectorAll('input[name="enabledNotifiers"]:checked'))
          .map(cb => cb.value);
        toggleNotificationConfigs(enabledNotifiers);
      });
    });
    
    document.getElementById('configForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const enabledNotifiers = Array.from(document.querySelectorAll('input[name="enabledNotifiers"]:checked'))
        .map(cb => cb.value);

      if (enabledNotifiers.length === 0) {
        showToast('請至少選擇一種通知方式', 'warning');
        return;
      }

      const config = {
        ADMIN_USERNAME: document.getElementById('adminUsername').value.trim(),
        TG_BOT_TOKEN: document.getElementById('tgBotToken').value.trim(),
        TG_CHAT_ID: document.getElementById('tgChatId').value.trim(),
        NOTIFYX_API_KEY: document.getElementById('notifyxApiKey').value.trim(),
        WEBHOOK_URL: document.getElementById('webhookUrl').value.trim(),
        WEBHOOK_METHOD: document.getElementById('webhookMethod').value,
        WEBHOOK_HEADERS: document.getElementById('webhookHeaders').value.trim(),
        WEBHOOK_TEMPLATE: document.getElementById('webhookTemplate').value.trim(),
        SHOW_LUNAR: document.getElementById('showLunarGlobal').checked,
        WECHATBOT_WEBHOOK: document.getElementById('wechatbotWebhook').value.trim(),
        WECHATBOT_MSG_TYPE: document.getElementById('wechatbotMsgType').value,
        WECHATBOT_AT_MOBILES: document.getElementById('wechatbotAtMobiles').value.trim(),
        WECHATBOT_AT_ALL: document.getElementById('wechatbotAtAll').checked.toString(),
        RESEND_API_KEY: document.getElementById('resendApiKey').value.trim(),
        EMAIL_FROM: document.getElementById('emailFrom').value.trim(),
        EMAIL_FROM_NAME: document.getElementById('emailFromName').value.trim(),
        EMAIL_TO: document.getElementById('emailTo').value.trim(),
        BARK_SERVER: document.getElementById('barkServer').value.trim() || 'https://api.day.app',
        BARK_DEVICE_KEY: document.getElementById('barkDeviceKey').value.trim(),
        BARK_IS_ARCHIVE: document.getElementById('barkIsArchive').checked.toString(),
        ENABLED_NOTIFIERS: enabledNotifiers,
        TIMEZONE: document.getElementById('timezone').value.trim(),
        THIRD_PARTY_API_TOKEN: document.getElementById('thirdPartyToken').value.trim(),
        // 前端先行整理通知小時列表，後端仍會再次校驗
        NOTIFICATION_HOURS: (() => {
          const raw = document.getElementById('notificationHours').value.trim();
          if (!raw) {
            return [];
          }
          return raw
            .split(/[,，\s]+/)
            .map(item => item.trim())
            .filter(item => item.length > 0);
        })()
      };

      const passwordField = document.getElementById('adminPassword');
      if (passwordField.value.trim()) {
        config.ADMIN_PASSWORD = passwordField.value.trim();
      }

      const submitButton = e.target.querySelector('button[type="submit"]');
      const originalContent = submitButton.innerHTML;
      submitButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>儲存中...';
      submitButton.disabled = true;

      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });

        const result = await response.json();

        if (result.success) {
          showToast('配置儲存成功', 'success');
          passwordField.value = '';
          
          // 更新全域性時區並重新顯示時間
          globalTimezone = config.TIMEZONE;
          showSystemTime();
          
          // 標記時區已更新，供其他頁面檢測
          localStorage.setItem('timezoneUpdated', Date.now().toString());
          
          // 如果當前在訂閱列表頁面，則自動重新整理頁面以更新時區顯示
          if (window.location.pathname === '/admin') {
            window.location.reload();
          }
        } else {
          showToast('配置儲存失敗: ' + (result.message || '未知錯誤'), 'error');
        }
      } catch (error) {
        console.error('儲存配置失敗:', error);
        showToast('儲存配置失敗，請稍後再試', 'error');
      } finally {
        submitButton.innerHTML = originalContent;
        submitButton.disabled = false;
      }
    });
    
    async function testNotification(type) {
      const buttonId = type === 'telegram' ? 'testTelegramBtn' :
                      type === 'notifyx' ? 'testNotifyXBtn' :
                      type === 'wechatbot' ? 'testWechatBotBtn' :
                      type === 'email' ? 'testEmailBtn' :
                      type === 'bark' ? 'testBarkBtn' : 'testWebhookBtn';
      const button = document.getElementById(buttonId);
      const originalContent = button.innerHTML;
      const serviceName = type === 'telegram' ? 'Telegram' :
                          type === 'notifyx' ? 'NotifyX' :
                          type === 'wechatbot' ? '企業微信機器人' :
                          type === 'email' ? '郵件通知' :
                          type === 'bark' ? 'Bark' : 'Webhook 通知';

      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>測試中...';
      button.disabled = true;

      const config = {};
      if (type === 'telegram') {
        config.TG_BOT_TOKEN = document.getElementById('tgBotToken').value.trim();
        config.TG_CHAT_ID = document.getElementById('tgChatId').value.trim();

        if (!config.TG_BOT_TOKEN || !config.TG_CHAT_ID) {
          showToast('請先填寫 Telegram Bot Token 和 Chat ID', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'notifyx') {
        config.NOTIFYX_API_KEY = document.getElementById('notifyxApiKey').value.trim();

        if (!config.NOTIFYX_API_KEY) {
          showToast('請先填寫 NotifyX API Key', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'webhook') {
        config.WEBHOOK_URL = document.getElementById('webhookUrl').value.trim();
        config.WEBHOOK_METHOD = document.getElementById('webhookMethod').value;
        config.WEBHOOK_HEADERS = document.getElementById('webhookHeaders').value.trim();
        config.WEBHOOK_TEMPLATE = document.getElementById('webhookTemplate').value.trim();

        if (!config.WEBHOOK_URL) {
          showToast('請先填寫 Webhook 通知 URL', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'wechatbot') {
        config.WECHATBOT_WEBHOOK = document.getElementById('wechatbotWebhook').value.trim();
        config.WECHATBOT_MSG_TYPE = document.getElementById('wechatbotMsgType').value;
        config.WECHATBOT_AT_MOBILES = document.getElementById('wechatbotAtMobiles').value.trim();
        config.WECHATBOT_AT_ALL = document.getElementById('wechatbotAtAll').checked.toString();

        if (!config.WECHATBOT_WEBHOOK) {
          showToast('請先填寫企業微信機器人 Webhook URL', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'email') {
        config.RESEND_API_KEY = document.getElementById('resendApiKey').value.trim();
        config.EMAIL_FROM = document.getElementById('emailFrom').value.trim();
        config.EMAIL_FROM_NAME = document.getElementById('emailFromName').value.trim();
        config.EMAIL_TO = document.getElementById('emailTo').value.trim();

        if (!config.RESEND_API_KEY || !config.EMAIL_FROM || !config.EMAIL_TO) {
          showToast('請先填寫 Resend API Key、發件人郵箱和收件人郵箱', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      } else if (type === 'bark') {
        config.BARK_SERVER = document.getElementById('barkServer').value.trim() || 'https://api.day.app';
        config.BARK_DEVICE_KEY = document.getElementById('barkDeviceKey').value.trim();
        config.BARK_IS_ARCHIVE = document.getElementById('barkIsArchive').checked.toString();

        if (!config.BARK_DEVICE_KEY) {
          showToast('請先填寫 Bark 裝置Key', 'warning');
          button.innerHTML = originalContent;
          button.disabled = false;
          return;
        }
      }

      try {
        const response = await fetch('/api/test-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: type, ...config })
        });

        const result = await response.json();

        if (result.success) {
          showToast(serviceName + ' 通知測試成功！', 'success');
        } else {
          showToast(serviceName + ' 通知測試失敗: ' + (result.message || '未知錯誤'), 'error');
        }
      } catch (error) {
        console.error('測試通知失敗:', error);
        showToast('測試失敗，請稍後再試', 'error');
      } finally {
        button.innerHTML = originalContent;
        button.disabled = false;
      }
    }
    
    document.getElementById('testTelegramBtn').addEventListener('click', () => {
      testNotification('telegram');
    });
    
    document.getElementById('testNotifyXBtn').addEventListener('click', () => {
      testNotification('notifyx');
    });

    document.getElementById('testWebhookBtn').addEventListener('click', () => {
      testNotification('webhook');
    });

    document.getElementById('testWechatBotBtn').addEventListener('click', () => {
      testNotification('wechatbot');
    });

    document.getElementById('testEmailBtn').addEventListener('click', () => {
      testNotification('email');
    });

    document.getElementById('testBarkBtn').addEventListener('click', () => {
      testNotification('bark');
    });

    document.getElementById('generateThirdPartyToken').addEventListener('click', () => {
      try {
        // 生成 32 位隨機令牌，避免出現特殊字元，方便寫入 URL
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const buffer = new Uint8Array(32);
        window.crypto.getRandomValues(buffer);
        const token = Array.from(buffer).map(v => charset[v % charset.length]).join('');
        const input = document.getElementById('thirdPartyToken');
        input.value = token;
        input.dispatchEvent(new Event('input'));
        showToast('已生成新的第三方 API 令牌，請儲存配置後生效', 'info');
      } catch (error) {
        console.error('生成令牌失敗:', error);
        showToast('生成令牌失敗，請手動輸入', 'error');
      }
    });

    window.addEventListener('load', loadConfig);
    
    // 全域性時區配置
    let globalTimezone = 'UTC';
    
    // 即時顯示系統時間和時區
    async function showSystemTime() {
      try {
        // 獲取後臺配置的時區
        const response = await fetch('/api/config');
        const config = await response.json();
        globalTimezone = config.TIMEZONE || 'UTC';
        
        // 格式化當前時間
        function formatTime(dt, tz) {
          return dt.toLocaleString('zh-CN', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        function formatTimezoneDisplay(tz) {
          try {
            // 使用更準確的時區偏移計算方法
            const now = new Date();
            const dtf = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              hour12: false,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            const parts = dtf.formatToParts(now);
            const get = type => Number(parts.find(x => x.type === type).value);
            const target = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
            const utc = now.getTime();
            const offset = Math.round((target - utc) / (1000 * 60 * 60));
            
            // 時區中文名稱對映
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
            
            const offsetStr = offset >= 0 ? '+' + offset : offset;
            const timezoneName = timezoneNames[tz] || tz;
            return timezoneName + ' (UTC' + offsetStr + ')';
          } catch (error) {
            console.error('格式化時區顯示失敗:', error);
            return tz;
          }
        }
        function update() {
          const now = new Date();
          const timeStr = formatTime(now, globalTimezone);
          const tzStr = formatTimezoneDisplay(globalTimezone);
          const el = document.getElementById('systemTimeDisplay');
          if (el) {
            el.textContent = timeStr + '  ' + tzStr;
          }
        }
        update();
        // 每秒重新整理
        setInterval(update, 1000);
        
        // 定期檢查時區變化並重新載入訂閱列表（每30秒檢查一次）
        setInterval(async () => {
          try {
            const response = await fetch('/api/config');
            const config = await response.json();
            const newTimezone = config.TIMEZONE || 'UTC';
            
            if (globalTimezone !== newTimezone) {
              globalTimezone = newTimezone;
              console.log('時區已更新為:', globalTimezone);
              // 重新載入訂閱列表以更新天數計算
              loadSubscriptions();
            }
          } catch (error) {
            console.error('檢查時區更新失敗:', error);
          }
        }, 30000);
      } catch (e) {
        // 出錯時顯示本地時間
        const el = document.getElementById('systemTimeDisplay');
        if (el) {
          el.textContent = new Date().toLocaleString();
        }
      }
    }
    showSystemTime();
  </script>
</body>
</html>
`;

// 管理頁面
// 與前端一致的分類切割正則，用於提取標籤資訊
const CATEGORY_SEPARATOR_REGEX = /[\/,，\s]+/;

function extractTagsFromSubscriptions(subscriptions = []) {
  const tagSet = new Set();
  (subscriptions || []).forEach(sub => {
    if (!sub || typeof sub !== 'object') {
      return;
    }
    if (Array.isArray(sub.tags)) {
      sub.tags.forEach(tag => {
        if (typeof tag === 'string' && tag.trim().length > 0) {
          tagSet.add(tag.trim());
        }
      });
    }
    if (typeof sub.category === 'string') {
      sub.category.split(CATEGORY_SEPARATOR_REGEX)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
        .forEach(tag => tagSet.add(tag));
    }
    if (typeof sub.customType === 'string' && sub.customType.trim().length > 0) {
      tagSet.add(sub.customType.trim());
    }
  });
  return Array.from(tagSet);
}

const admin = {
  async handleRequest(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      console.log('[管理頁面] 訪問路徑:', pathname);

      const token = getCookieValue(request.headers.get('Cookie'), 'token');
      console.log('[管理頁面] Token存在:', !!token);

      const config = await getConfig(env);
      const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;

      console.log('[管理頁面] 使用者驗證結果:', !!user);

      if (!user) {
        console.log('[管理頁面] 使用者未登入，重定向到登入頁面');
        return new Response('', {
          status: 302,
          headers: { 'Location': '/' }
        });
      }

      if (pathname === '/admin/config') {
        return new Response(configPage, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }

      return new Response(adminPage, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('[管理頁面] 處理請求時出錯:', error);
      return new Response('伺服器內部錯誤', {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};

// 處理API請求
const api = {
  async handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.slice(4);
    const method = request.method;

    const config = await getConfig(env);

    if (path === '/login' && method === 'POST') {
      const body = await request.json();

      if (body.username === config.ADMIN_USERNAME && body.password === config.ADMIN_PASSWORD) {
        const token = await generateJWT(body.username, config.JWT_SECRET);

        return new Response(
          JSON.stringify({ success: true }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': 'token=' + token + '; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400'
            }
          }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, message: '使用者名稱或密碼錯誤' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (path === '/logout' && (method === 'GET' || method === 'POST')) {
      return new Response('', {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': 'token=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'
        }
      });
    }

    const token = getCookieValue(request.headers.get('Cookie'), 'token');
    const user = token ? await verifyJWT(token, config.JWT_SECRET) : null;

    if (!user && path !== '/login') {
      return new Response(
        JSON.stringify({ success: false, message: '未授權訪問' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (path === '/config') {
      if (method === 'GET') {
        const { JWT_SECRET, ADMIN_PASSWORD, ...safeConfig } = config;
        return new Response(
          JSON.stringify(safeConfig),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'POST') {
        try {
          const newConfig = await request.json();

          const updatedConfig = {
            ...config,
            ADMIN_USERNAME: newConfig.ADMIN_USERNAME || config.ADMIN_USERNAME,
            TG_BOT_TOKEN: newConfig.TG_BOT_TOKEN || '',
            TG_CHAT_ID: newConfig.TG_CHAT_ID || '',
            NOTIFYX_API_KEY: newConfig.NOTIFYX_API_KEY || '',
            WEBHOOK_URL: newConfig.WEBHOOK_URL || '',
            WEBHOOK_METHOD: newConfig.WEBHOOK_METHOD || 'POST',
            WEBHOOK_HEADERS: newConfig.WEBHOOK_HEADERS || '',
            WEBHOOK_TEMPLATE: newConfig.WEBHOOK_TEMPLATE || '',
            SHOW_LUNAR: newConfig.SHOW_LUNAR === true,
            WECHATBOT_WEBHOOK: newConfig.WECHATBOT_WEBHOOK || '',
            WECHATBOT_MSG_TYPE: newConfig.WECHATBOT_MSG_TYPE || 'text',
            WECHATBOT_AT_MOBILES: newConfig.WECHATBOT_AT_MOBILES || '',
            WECHATBOT_AT_ALL: newConfig.WECHATBOT_AT_ALL || 'false',
            RESEND_API_KEY: newConfig.RESEND_API_KEY || '',
            EMAIL_FROM: newConfig.EMAIL_FROM || '',
            EMAIL_FROM_NAME: newConfig.EMAIL_FROM_NAME || '',
            EMAIL_TO: newConfig.EMAIL_TO || '',
            BARK_DEVICE_KEY: newConfig.BARK_DEVICE_KEY || '',
            BARK_SERVER: newConfig.BARK_SERVER || 'https://api.day.app',
            BARK_IS_ARCHIVE: newConfig.BARK_IS_ARCHIVE || 'false',
            ENABLED_NOTIFIERS: newConfig.ENABLED_NOTIFIERS || ['notifyx'],
            TIMEZONE: newConfig.TIMEZONE || config.TIMEZONE || 'UTC',
            THIRD_PARTY_API_TOKEN: newConfig.THIRD_PARTY_API_TOKEN || ''
          };

          const rawNotificationHours = Array.isArray(newConfig.NOTIFICATION_HOURS)
            ? newConfig.NOTIFICATION_HOURS
            : typeof newConfig.NOTIFICATION_HOURS === 'string'
              ? newConfig.NOTIFICATION_HOURS.split(',')
              : [];

          const sanitizedNotificationHours = rawNotificationHours
            .map(value => String(value).trim())
            .filter(value => value.length > 0)
            .map(value => {
              const upperValue = value.toUpperCase();
              if (upperValue === '*' || upperValue === 'ALL') {
                return '*';
              }
              const numeric = Number(upperValue);
              if (!isNaN(numeric)) {
                return String(Math.max(0, Math.min(23, Math.floor(numeric)))).padStart(2, '0');
              }
              return upperValue;
            });

          updatedConfig.NOTIFICATION_HOURS = sanitizedNotificationHours;

          if (newConfig.ADMIN_PASSWORD) {
            updatedConfig.ADMIN_PASSWORD = newConfig.ADMIN_PASSWORD;
          }

          // 確保JWT_SECRET存在且安全
          if (!updatedConfig.JWT_SECRET || updatedConfig.JWT_SECRET === 'your-secret-key') {
            updatedConfig.JWT_SECRET = generateRandomSecret();
            console.log('[安全] 生成新的JWT金鑰');
          }

          await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(updatedConfig));

          return new Response(
            JSON.stringify({ success: true }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          console.error('配置儲存錯誤:', error);
          return new Response(
            JSON.stringify({ success: false, message: '更新配置失敗: ' + error.message }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    if (path === '/test-notification' && method === 'POST') {
      try {
        const body = await request.json();
        let success = false;
        let message = '';

        if (body.type === 'telegram') {
          const testConfig = {
            ...config,
            TG_BOT_TOKEN: body.TG_BOT_TOKEN,
            TG_CHAT_ID: body.TG_CHAT_ID
          };

          const content = '*測試通知*\n\n這是一條測試通知，用於驗證Telegram通知功能是否正常工作。\n\n傳送時間: ' + formatBeijingTime();
          success = await sendTelegramNotification(content, testConfig);
          message = success ? 'Telegram通知傳送成功' : 'Telegram通知傳送失敗，請檢查配置';
        } else if (body.type === 'notifyx') {
          const testConfig = {
            ...config,
            NOTIFYX_API_KEY: body.NOTIFYX_API_KEY
          };

          const title = '測試通知';
          const content = '## 這是一條測試通知\n\n用於驗證NotifyX通知功能是否正常工作。\n\n傳送時間: ' + formatBeijingTime();
          const description = '測試NotifyX通知功能';

          success = await sendNotifyXNotification(title, content, description, testConfig);
          message = success ? 'NotifyX通知傳送成功' : 'NotifyX通知傳送失敗，請檢查配置';
        } else if (body.type === 'webhook') {
          const testConfig = {
            ...config,
            WEBHOOK_URL: body.WEBHOOK_URL,
            WEBHOOK_METHOD: body.WEBHOOK_METHOD,
            WEBHOOK_HEADERS: body.WEBHOOK_HEADERS,
            WEBHOOK_TEMPLATE: body.WEBHOOK_TEMPLATE
          };

          const title = '測試通知';
          const content = '這是一條測試通知，用於驗證Webhook 通知功能是否正常工作。\n\n傳送時間: ' + formatBeijingTime();

          success = await sendWebhookNotification(title, content, testConfig);
          message = success ? 'Webhook 通知傳送成功' : 'Webhook 通知傳送失敗，請檢查配置';
         } else if (body.type === 'wechatbot') {
          const testConfig = {
            ...config,
            WECHATBOT_WEBHOOK: body.WECHATBOT_WEBHOOK,
            WECHATBOT_MSG_TYPE: body.WECHATBOT_MSG_TYPE,
            WECHATBOT_AT_MOBILES: body.WECHATBOT_AT_MOBILES,
            WECHATBOT_AT_ALL: body.WECHATBOT_AT_ALL
          };

          const title = '測試通知';
          const content = '這是一條測試通知，用於驗證企業微信機器人功能是否正常工作。\n\n傳送時間: ' + formatBeijingTime();

          success = await sendWechatBotNotification(title, content, testConfig);
          message = success ? '企業微信機器人通知傳送成功' : '企業微信機器人通知傳送失敗，請檢查配置';
        } else if (body.type === 'email') {
          const testConfig = {
            ...config,
            RESEND_API_KEY: body.RESEND_API_KEY,
            EMAIL_FROM: body.EMAIL_FROM,
            EMAIL_FROM_NAME: body.EMAIL_FROM_NAME,
            EMAIL_TO: body.EMAIL_TO
          };

          const title = '測試通知';
          const content = '這是一條測試通知，用於驗證郵件通知功能是否正常工作。\n\n傳送時間: ' + formatBeijingTime();

          success = await sendEmailNotification(title, content, testConfig);
          message = success ? '郵件通知傳送成功' : '郵件通知傳送失敗，請檢查配置';
        } else if (body.type === 'bark') {
          const testConfig = {
            ...config,
            BARK_SERVER: body.BARK_SERVER,
            BARK_DEVICE_KEY: body.BARK_DEVICE_KEY,
            BARK_IS_ARCHIVE: body.BARK_IS_ARCHIVE
          };

          const title = '測試通知';
          const content = '這是一條測試通知，用於驗證Bark通知功能是否正常工作。\n\n傳送時間: ' + formatBeijingTime();

          success = await sendBarkNotification(title, content, testConfig);
          message = success ? 'Bark通知傳送成功' : 'Bark通知傳送失敗，請檢查配置';
        }

        return new Response(
          JSON.stringify({ success, message }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        console.error('測試通知失敗:', error);
        return new Response(
          JSON.stringify({ success: false, message: '測試通知失敗: ' + error.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (path === '/subscriptions') {
      if (method === 'GET') {
        const subscriptions = await getAllSubscriptions(env);
        return new Response(
          JSON.stringify(subscriptions),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'POST') {
        const subscription = await request.json();
        const result = await createSubscription(subscription, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 201 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    if (path.startsWith('/subscriptions/')) {
      const parts = path.split('/');
      const id = parts[2];

      if (parts[3] === 'toggle-status' && method === 'POST') {
        const body = await request.json();
        const result = await toggleSubscriptionStatus(id, body.isActive, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 200 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      if (parts[3] === 'test-notify' && method === 'POST') {
        const result = await testSingleSubscriptionNotification(id, env);
        return new Response(JSON.stringify(result), { status: result.success ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
      }

      if (method === 'GET') {
        const subscription = await getSubscription(id, env);

        return new Response(
          JSON.stringify(subscription),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'PUT') {
        const subscription = await request.json();
        const result = await updateSubscription(id, subscription, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 200 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }

      if (method === 'DELETE') {
        const result = await deleteSubscription(id, env);

        return new Response(
          JSON.stringify(result),
          {
            status: result.success ? 200 : 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    }

    // 處理第三方通知API
    if (path.startsWith('/notify/')) {
      const pathSegments = path.split('/');
      // 允許透過路徑、Authorization 頭或查詢引數三種方式傳入訪問令牌
      const tokenFromPath = pathSegments[2] || '';
      const tokenFromHeader = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      const tokenFromQuery = url.searchParams.get('token') || '';
      const providedToken = tokenFromPath || tokenFromHeader || tokenFromQuery;
      const expectedToken = config.THIRD_PARTY_API_TOKEN || '';

      if (!expectedToken) {
        return new Response(
          JSON.stringify({ message: '第三方 API 已停用，請在後臺配置訪問令牌後使用' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!providedToken || providedToken !== expectedToken) {
        return new Response(
          JSON.stringify({ message: '訪問未授權，令牌無效或缺失' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'POST') {
        try {
          const body = await request.json();
          const title = body.title || '第三方通知';
          const content = body.content || '';

          if (!content) {
            return new Response(
              JSON.stringify({ message: '缺少必填引數 content' }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const config = await getConfig(env);
          const bodyTagsRaw = Array.isArray(body.tags)
            ? body.tags
            : (typeof body.tags === 'string' ? body.tags.split(/[,，\s]+/) : []);
          const bodyTags = Array.isArray(bodyTagsRaw)
            ? bodyTagsRaw.filter(tag => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim())
            : [];

          // 使用多渠道傳送通知
          await sendNotificationToAllChannels(title, content, config, '[第三方API]', {
            metadata: { tags: bodyTags }
          });

          return new Response(
            JSON.stringify({
              message: '傳送成功',
              response: {
                errcode: 0,
                errmsg: 'ok',
                msgid: 'MSGID' + Date.now()
              }
            }),
            { headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          console.error('[第三方API] 傳送通知失敗:', error);
          return new Response(
            JSON.stringify({
              message: '傳送失敗',
              response: {
                errcode: 1,
                errmsg: error.message
              }
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    return new Response(
      JSON.stringify({ success: false, message: '未找到請求的資源' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// 工具函式
function generateRandomSecret() {
  // 生成一個64字元的隨機金鑰
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function getConfig(env) {
  try {
    if (!env.SUBSCRIPTIONS_KV) {
      console.error('[配置] KV儲存未繫結');
      throw new Error('KV儲存未繫結');
    }

    const data = await env.SUBSCRIPTIONS_KV.get('config');
    console.log('[配置] 從KV讀取配置:', data ? '成功' : '空配置');

    const config = data ? JSON.parse(data) : {};

    // 確保JWT_SECRET的一致性
    let jwtSecret = config.JWT_SECRET;
    if (!jwtSecret || jwtSecret === 'your-secret-key') {
      jwtSecret = generateRandomSecret();
      console.log('[配置] 生成新的JWT金鑰');

      // 儲存新的JWT金鑰
      const updatedConfig = { ...config, JWT_SECRET: jwtSecret };
      await env.SUBSCRIPTIONS_KV.put('config', JSON.stringify(updatedConfig));
    }

    const finalConfig = {
      ADMIN_USERNAME: config.ADMIN_USERNAME || 'admin',
      ADMIN_PASSWORD: config.ADMIN_PASSWORD || 'password',
      JWT_SECRET: jwtSecret,
      TG_BOT_TOKEN: config.TG_BOT_TOKEN || '',
      TG_CHAT_ID: config.TG_CHAT_ID || '',
      NOTIFYX_API_KEY: config.NOTIFYX_API_KEY || '',
      WEBHOOK_URL: config.WEBHOOK_URL || '',
      WEBHOOK_METHOD: config.WEBHOOK_METHOD || 'POST',
      WEBHOOK_HEADERS: config.WEBHOOK_HEADERS || '',
      WEBHOOK_TEMPLATE: config.WEBHOOK_TEMPLATE || '',
      SHOW_LUNAR: config.SHOW_LUNAR === true,
      WECHATBOT_WEBHOOK: config.WECHATBOT_WEBHOOK || '',
      WECHATBOT_MSG_TYPE: config.WECHATBOT_MSG_TYPE || 'text',
      WECHATBOT_AT_MOBILES: config.WECHATBOT_AT_MOBILES || '',
      WECHATBOT_AT_ALL: config.WECHATBOT_AT_ALL || 'false',
      RESEND_API_KEY: config.RESEND_API_KEY || '',
      EMAIL_FROM: config.EMAIL_FROM || '',
      EMAIL_FROM_NAME: config.EMAIL_FROM_NAME || '',
      EMAIL_TO: config.EMAIL_TO || '',
      BARK_DEVICE_KEY: config.BARK_DEVICE_KEY || '',
      BARK_SERVER: config.BARK_SERVER || 'https://api.day.app',
      BARK_IS_ARCHIVE: config.BARK_IS_ARCHIVE || 'false',
      ENABLED_NOTIFIERS: config.ENABLED_NOTIFIERS || ['notifyx'],
      TIMEZONE: config.TIMEZONE || 'UTC', // 新增時區欄位
      NOTIFICATION_HOURS: Array.isArray(config.NOTIFICATION_HOURS) ? config.NOTIFICATION_HOURS : [],
      THIRD_PARTY_API_TOKEN: config.THIRD_PARTY_API_TOKEN || ''
    };

    console.log('[配置] 最終配置使用者名稱:', finalConfig.ADMIN_USERNAME);
    return finalConfig;
  } catch (error) {
    console.error('[配置] 獲取配置失敗:', error);
    const defaultJwtSecret = generateRandomSecret();

    return {
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'password',
      JWT_SECRET: defaultJwtSecret,
      TG_BOT_TOKEN: '',
      TG_CHAT_ID: '',
      NOTIFYX_API_KEY: '',
      WEBHOOK_URL: '',
      WEBHOOK_METHOD: 'POST',
      WEBHOOK_HEADERS: '',
      WEBHOOK_TEMPLATE: '',
      SHOW_LUNAR: true,
      WECHATBOT_WEBHOOK: '',
      WECHATBOT_MSG_TYPE: 'text',
      WECHATBOT_AT_MOBILES: '',
      WECHATBOT_AT_ALL: 'false',
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      EMAIL_FROM_NAME: '',
      EMAIL_TO: '',
      ENABLED_NOTIFIERS: ['notifyx'],
      NOTIFICATION_HOURS: [],
      TIMEZONE: 'UTC', // 新增時區欄位
      THIRD_PARTY_API_TOKEN: ''
    };
  }
}

async function generateJWT(username, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { username, iat: Math.floor(Date.now() / 1000) };

  const headerBase64 = btoa(JSON.stringify(header));
  const payloadBase64 = btoa(JSON.stringify(payload));

  const signatureInput = headerBase64 + '.' + payloadBase64;
  const signature = await CryptoJS.HmacSHA256(signatureInput, secret);

  return headerBase64 + '.' + payloadBase64 + '.' + signature;
}

async function verifyJWT(token, secret) {
  try {
    if (!token || !secret) {
      console.log('[JWT] Token或Secret為空');
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log('[JWT] Token格式錯誤，部分數量:', parts.length);
      return null;
    }

    const [headerBase64, payloadBase64, signature] = parts;
    const signatureInput = headerBase64 + '.' + payloadBase64;
    const expectedSignature = await CryptoJS.HmacSHA256(signatureInput, secret);

    if (signature !== expectedSignature) {
      console.log('[JWT] 簽名驗證失敗');
      return null;
    }

    const payload = JSON.parse(atob(payloadBase64));
    console.log('[JWT] 驗證成功，使用者:', payload.username);
    return payload;
  } catch (error) {
    console.error('[JWT] 驗證過程出錯:', error);
    return null;
  }
}

async function getAllSubscriptions(env) {
  try {
    const data = await env.SUBSCRIPTIONS_KV.get('subscriptions');
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
}

async function getSubscription(id, env) {
  const subscriptions = await getAllSubscriptions(env);
  return subscriptions.find(s => s.id === id);
}

// 2. 修改 createSubscription，支援 useLunar 欄位
async function createSubscription(subscription, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);

    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: '缺少必填欄位' };
    }

    let expiryDate = new Date(subscription.expiryDate);
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);
    

    let useLunar = !!subscription.useLunar;
    if (useLunar) {
      let lunar = lunarCalendar.solar2lunar(
        expiryDate.getFullYear(),
        expiryDate.getMonth() + 1,
        expiryDate.getDate()
      );
      
      if (lunar && subscription.periodValue && subscription.periodUnit) {
        // 如果到期日<=今天，自動推算到下一個週期
        while (expiryDate <= currentTime) {
          lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
          const solar = lunarBiz.lunar2solar(lunar);
          expiryDate = new Date(solar.year, solar.month - 1, solar.day);
        }
        subscription.expiryDate = expiryDate.toISOString();
      }
    } else {
      if (expiryDate < currentTime && subscription.periodValue && subscription.periodUnit) {
        while (expiryDate < currentTime) {
          if (subscription.periodUnit === 'day') {
            expiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
          } else if (subscription.periodUnit === 'month') {
            expiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
          } else if (subscription.periodUnit === 'year') {
            expiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
          }
        }
        subscription.expiryDate = expiryDate.toISOString();
      }
    }

    const reminderSetting = resolveReminderSetting(subscription);

    const newSubscription = {
      id: Date.now().toString(), // 前端使用本地時間戳
      name: subscription.name,
      customType: subscription.customType || '',
      category: subscription.category ? subscription.category.trim() : '',
      startDate: subscription.startDate || null,
      expiryDate: subscription.expiryDate,
      periodValue: subscription.periodValue || 1,
      periodUnit: subscription.periodUnit || 'month',
      reminderUnit: reminderSetting.unit,
      reminderValue: reminderSetting.value,
      reminderDays: reminderSetting.unit === 'day' ? reminderSetting.value : undefined,
      reminderHours: reminderSetting.unit === 'hour' ? reminderSetting.value : undefined,
      notes: subscription.notes || '',
      isActive: subscription.isActive !== false,
      autoRenew: subscription.autoRenew !== false,
      useLunar: useLunar,
      createdAt: new Date().toISOString()
    };

    subscriptions.push(newSubscription);

    await env.SUBSCRIPTIONS_KV.put('subscriptions', JSON.stringify(subscriptions));

    return { success: true, subscription: newSubscription };
  } catch (error) {
    console.error("建立訂閱異常：", error && error.stack ? error.stack : error);
    return { success: false, message: error && error.message ? error.message : '建立訂閱失敗' };
  }
}

// 3. 修改 updateSubscription，支援 useLunar 欄位
async function updateSubscription(id, subscription, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);
    const index = subscriptions.findIndex(s => s.id === id);

    if (index === -1) {
      return { success: false, message: '訂閱不存在' };
    }

    if (!subscription.name || !subscription.expiryDate) {
      return { success: false, message: '缺少必填欄位' };
    }

    let expiryDate = new Date(subscription.expiryDate);
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);

let useLunar = !!subscription.useLunar;
if (useLunar) {
  let lunar = lunarCalendar.solar2lunar(
    expiryDate.getFullYear(),
    expiryDate.getMonth() + 1,
    expiryDate.getDate()
  );
  if (!lunar) {
    return { success: false, message: '農曆日期超出支援範圍（1900-2100年）' };
  }
  if (lunar && expiryDate < currentTime && subscription.periodValue && subscription.periodUnit) {
    // 新增：迴圈加週期，直到 expiryDate > currentTime
    do {
      lunar = lunarBiz.addLunarPeriod(lunar, subscription.periodValue, subscription.periodUnit);
      const solar = lunarBiz.lunar2solar(lunar);
      expiryDate = new Date(solar.year, solar.month - 1, solar.day);
    } while (expiryDate < currentTime);
    subscription.expiryDate = expiryDate.toISOString();
  }
} else {
      if (expiryDate < currentTime && subscription.periodValue && subscription.periodUnit) {
        while (expiryDate < currentTime) {
          if (subscription.periodUnit === 'day') {
            expiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
          } else if (subscription.periodUnit === 'month') {
            expiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
          } else if (subscription.periodUnit === 'year') {
            expiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
          }
        }
        subscription.expiryDate = expiryDate.toISOString();
      }
    }

    const reminderSource = {
      reminderUnit: subscription.reminderUnit !== undefined ? subscription.reminderUnit : subscriptions[index].reminderUnit,
      reminderValue: subscription.reminderValue !== undefined ? subscription.reminderValue : subscriptions[index].reminderValue,
      reminderHours: subscription.reminderHours !== undefined ? subscription.reminderHours : subscriptions[index].reminderHours,
      reminderDays: subscription.reminderDays !== undefined ? subscription.reminderDays : subscriptions[index].reminderDays
    };
    const reminderSetting = resolveReminderSetting(reminderSource);

    subscriptions[index] = {
      ...subscriptions[index],
      name: subscription.name,
      customType: subscription.customType || subscriptions[index].customType || '',
      category: subscription.category !== undefined ? subscription.category.trim() : (subscriptions[index].category || ''),
      startDate: subscription.startDate || subscriptions[index].startDate,
      expiryDate: subscription.expiryDate,
      periodValue: subscription.periodValue || subscriptions[index].periodValue || 1,
      periodUnit: subscription.periodUnit || subscriptions[index].periodUnit || 'month',
      reminderUnit: reminderSetting.unit,
      reminderValue: reminderSetting.value,
      reminderDays: reminderSetting.unit === 'day' ? reminderSetting.value : undefined,
      reminderHours: reminderSetting.unit === 'hour' ? reminderSetting.value : undefined,
      notes: subscription.notes || '',
      isActive: subscription.isActive !== undefined ? subscription.isActive : subscriptions[index].isActive,
      autoRenew: subscription.autoRenew !== undefined ? subscription.autoRenew : (subscriptions[index].autoRenew !== undefined ? subscriptions[index].autoRenew : true),
      useLunar: useLunar,
      updatedAt: new Date().toISOString()
    };

    await env.SUBSCRIPTIONS_KV.put('subscriptions', JSON.stringify(subscriptions));

    return { success: true, subscription: subscriptions[index] };
  } catch (error) {
    return { success: false, message: '更新訂閱失敗' };
  }
}

async function deleteSubscription(id, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);
    const filteredSubscriptions = subscriptions.filter(s => s.id !== id);

    if (filteredSubscriptions.length === subscriptions.length) {
      return { success: false, message: '訂閱不存在' };
    }

    await env.SUBSCRIPTIONS_KV.put('subscriptions', JSON.stringify(filteredSubscriptions));

    return { success: true };
  } catch (error) {
    return { success: false, message: '刪除訂閱失敗' };
  }
}

async function toggleSubscriptionStatus(id, isActive, env) {
  try {
    const subscriptions = await getAllSubscriptions(env);
    const index = subscriptions.findIndex(s => s.id === id);

    if (index === -1) {
      return { success: false, message: '訂閱不存在' };
    }

    subscriptions[index] = {
      ...subscriptions[index],
      isActive: isActive,
      updatedAt: new Date().toISOString()
    };

    await env.SUBSCRIPTIONS_KV.put('subscriptions', JSON.stringify(subscriptions));

    return { success: true, subscription: subscriptions[index] };
  } catch (error) {
    return { success: false, message: '更新訂閱狀態失敗' };
  }
}

async function testSingleSubscriptionNotification(id, env) {
  try {
    const subscription = await getSubscription(id, env);
    if (!subscription) {
      return { success: false, message: '未找到該訂閱' };
    }
    const config = await getConfig(env);

    const title = `手動測試通知: ${subscription.name}`;

    // 檢查是否顯示農曆（從配置中獲取，預設不顯示）
    const showLunar = config.SHOW_LUNAR === true;
    let lunarExpiryText = '';

    if (showLunar) {
      // 計算農曆日期
      const expiryDateObj = new Date(subscription.expiryDate);
      const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
      lunarExpiryText = lunarExpiry ? ` (農曆: ${lunarExpiry.fullStr})` : '';
    }

    // 格式化到期日期（使用所選時區）
    const timezone = config?.TIMEZONE || 'UTC';
    const formattedExpiryDate = formatTimeInTimezone(new Date(subscription.expiryDate), timezone, 'date');
    const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
    
    // 獲取日曆型別和自動續期狀態
    const calendarType = subscription.useLunar ? '農曆' : '公曆';
    const autoRenewText = subscription.autoRenew ? '是' : '否';
    
    const commonContent = `**訂閱詳情**
型別: ${subscription.customType || '其他'}
日曆型別: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自動續期: ${autoRenewText}
備註: ${subscription.notes || '無'}
傳送時間: ${currentTime}
當前時區: ${formatTimezoneDisplay(timezone)}`;

    // 使用多渠道傳送
    const tags = extractTagsFromSubscriptions([subscription]);
    await sendNotificationToAllChannels(title, commonContent, config, '[手動測試]', {
      metadata: { tags }
    });

    return { success: true, message: '測試通知已傳送到所有啟用的渠道' };

  } catch (error) {
    console.error('[手動測試] 傳送失敗:', error);
    return { success: false, message: '傳送時發生錯誤: ' + error.message };
  }
}

async function sendWebhookNotification(title, content, config, metadata = {}) {
  try {
    if (!config.WEBHOOK_URL) {
      console.error('[Webhook通知] 通知未配置，缺少URL');
      return false;
    }

    console.log('[Webhook通知] 開始傳送通知到: ' + config.WEBHOOK_URL);

    let requestBody;
    let headers = { 'Content-Type': 'application/json' };

    // 處理自定義請求頭
    if (config.WEBHOOK_HEADERS) {
      try {
        const customHeaders = JSON.parse(config.WEBHOOK_HEADERS);
        headers = { ...headers, ...customHeaders };
      } catch (error) {
        console.warn('[Webhook通知] 自定義請求頭格式錯誤，使用預設請求頭');
      }
    }

    const tagsArray = Array.isArray(metadata.tags)
      ? metadata.tags.filter(tag => typeof tag === 'string' && tag.trim().length > 0).map(tag => tag.trim())
      : [];
    const tagsBlock = tagsArray.length ? tagsArray.map(tag => `- ${tag}`).join('\n') : '';
    const tagsLine = tagsArray.length ? '標籤：' + tagsArray.join('、') : '';
    const timestamp = formatTimeInTimezone(new Date(), config?.TIMEZONE || 'UTC', 'datetime');
    const formattedMessage = [title, content, tagsLine, `傳送時間：${timestamp}`]
      .filter(section => section && section.trim().length > 0)
      .join('\n\n');

    const templateData = {
      title,
      content,
      tags: tagsBlock,
      tagsLine,
      rawTags: tagsArray,
      timestamp,
      formattedMessage,
      message: formattedMessage
    };

    const escapeForJson = (value) => {
      if (value === null || value === undefined) {
        return '';
      }
      return JSON.stringify(String(value)).slice(1, -1);
    };

    const applyTemplate = (template, data) => {
      const templateString = JSON.stringify(template);
      const replaced = templateString.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          return escapeForJson(data[key]);
        }
        return '';
      });
      return JSON.parse(replaced);
    };

    // 處理訊息模板
    if (config.WEBHOOK_TEMPLATE) {
      try {
        const template = JSON.parse(config.WEBHOOK_TEMPLATE);
        requestBody = applyTemplate(template, templateData);
      } catch (error) {
        console.warn('[Webhook通知] 訊息模板格式錯誤，使用預設格式');
        requestBody = {
          title,
          content,
          tags: tagsArray,
          tagsLine,
          timestamp,
          message: formattedMessage
        };
      }
    } else {
      requestBody = {
        title,
        content,
        tags: tagsArray,
        tagsLine,
        timestamp,
        message: formattedMessage
      };
    }

    const response = await fetch(config.WEBHOOK_URL, {
      method: config.WEBHOOK_METHOD || 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    const result = await response.text();
    console.log('[Webhook通知] 傳送結果:', response.status, result);
    return response.ok;
  } catch (error) {
    console.error('[Webhook通知] 傳送通知失敗:', error);
    return false;
  }
}

async function sendWeComNotification(message, config) {
    // This is a placeholder. In a real scenario, you would implement the WeCom notification logic here.
    console.log("[企業微信] 通知功能未實現");
    return { success: false, message: "企業微信通知功能未實現" };
}

async function sendWechatBotNotification(title, content, config) {
  try {
    if (!config.WECHATBOT_WEBHOOK) {
      console.error('[企業微信機器人] 通知未配置，缺少Webhook URL');
      return false;
    }

    console.log('[企業微信機器人] 開始傳送通知到: ' + config.WECHATBOT_WEBHOOK);

    // 構建訊息內容
    let messageData;
    const msgType = config.WECHATBOT_MSG_TYPE || 'text';

    if (msgType === 'markdown') {
      // Markdown 訊息格式
      const markdownContent = `# ${title}\n\n${content}`;
      messageData = {
        msgtype: 'markdown',
        markdown: {
          content: markdownContent
        }
      };
    } else {
      // 文字訊息格式 - 最佳化顯示
      const textContent = `${title}\n\n${content}`;
      messageData = {
        msgtype: 'text',
        text: {
          content: textContent
        }
      };
    }

    // 處理@功能
    if (config.WECHATBOT_AT_ALL === 'true') {
      // @所有人
      if (msgType === 'text') {
        messageData.text.mentioned_list = ['@all'];
      }
    } else if (config.WECHATBOT_AT_MOBILES) {
      // @指定手機號
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
      headers: {
        'Content-Type': 'application/json'
      },
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

// 最佳化通知內容格式
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

    // 格式化到期日期（使用所選時區）
    const expiryDateObj = new Date(sub.expiryDate);
    const formattedExpiryDate = formatTimeInTimezone(expiryDateObj, timezone, 'date');
    
    // 農曆日期
    let lunarExpiryText = '';
    if (showLunar) {
      const lunarExpiry = lunarCalendar.solar2lunar(expiryDateObj.getFullYear(), expiryDateObj.getMonth() + 1, expiryDateObj.getDate());
      lunarExpiryText = lunarExpiry ? `
農曆日期: ${lunarExpiry.fullStr}` : '';
    }

    // 狀態和到期時間
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
      statusText = `將在 ${sub.daysRemaining} 天后到期`;
    }

    const reminderSuffix = reminderSetting.value === 0
      ? '（僅到期時提醒）'
      : (reminderSetting.unit === 'hour' ? '（小時級提醒）' : '');
    const reminderText = reminderSetting.unit === 'hour'
      ? `提醒策略: 提前 ${reminderSetting.value} 小時${reminderSuffix}`
      : `提醒策略: 提前 ${reminderSetting.value} 天${reminderSuffix}`;

    // 獲取日曆型別和自動續期狀態
    const calendarType = sub.useLunar ? '農曆' : '公曆';
    const autoRenewText = sub.autoRenew ? '是' : '否';
    
    // 構建格式化的通知內容
    const subscriptionContent = `${statusEmoji} **${sub.name}**
型別: ${typeText} ${periodText}
分類: ${categoryText}
日曆型別: ${calendarType}
到期日期: ${formattedExpiryDate}${lunarExpiryText}
自動續期: ${autoRenewText}
${reminderText}
到期狀態: ${statusText}`;

    // 新增備註
    let finalContent = sub.notes ? 
      subscriptionContent + `\n備註: ${sub.notes}` : 
      subscriptionContent;

    content += finalContent + '\n\n';
  }

  // 添加發送時間和時區資訊
  const currentTime = formatTimeInTimezone(new Date(), timezone, 'datetime');
  content += `傳送時間: ${currentTime}\n當前時區: ${formatTimezoneDisplay(timezone)}`;

  return content;
}

async function sendNotificationToAllChannels(title, commonContent, config, logPrefix = '[定時任務]', options = {}) {
  const metadata = options.metadata || {};
    if (!config.ENABLED_NOTIFIERS || config.ENABLED_NOTIFIERS.length === 0) {
        console.log(`${logPrefix} 未啟用任何通知渠道。`);
        return;
    }

    if (config.ENABLED_NOTIFIERS.includes('notifyx')) {
        const notifyxContent = `## ${title}\n\n${commonContent}`;
        const success = await sendNotifyXNotification(title, notifyxContent, `訂閱提醒`, config);
        console.log(`${logPrefix} 傳送NotifyX通知 ${success ? '成功' : '失敗'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('telegram')) {
        const telegramContent = `*${title}*\n\n${commonContent}`;
        const success = await sendTelegramNotification(telegramContent, config);
        console.log(`${logPrefix} 傳送Telegram通知 ${success ? '成功' : '失敗'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('webhook')) {
        const webhookContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
        const success = await sendWebhookNotification(title, webhookContent, config, metadata);
        console.log(`${logPrefix} 傳送Webhook通知 ${success ? '成功' : '失敗'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('wechatbot')) {
        const wechatbotContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
        const success = await sendWechatBotNotification(title, wechatbotContent, config);
        console.log(`${logPrefix} 傳送企業微信機器人通知 ${success ? '成功' : '失敗'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('weixin')) {
        const weixinContent = `【${title}】\n\n${commonContent.replace(/(\**|\*|##|#|`)/g, '')}`;
        const result = await sendWeComNotification(weixinContent, config);
        console.log(`${logPrefix} 傳送企業微信通知 ${result.success ? '成功' : '失敗'}. ${result.message}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('email')) {
        const emailContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
        const success = await sendEmailNotification(title, emailContent, config);
        console.log(`${logPrefix} 傳送郵件通知 ${success ? '成功' : '失敗'}`);
    }
    if (config.ENABLED_NOTIFIERS.includes('bark')) {
        const barkContent = commonContent.replace(/(\**|\*|##|#|`)/g, '');
        const success = await sendBarkNotification(title, barkContent, config);
        console.log(`${logPrefix} 傳送Bark通知 ${success ? '成功' : '失敗'}`);
    }
}

async function sendTelegramNotification(message, config) {
  try {
    if (!config.TG_BOT_TOKEN || !config.TG_CHAT_ID) {
      console.error('[Telegram] 通知未配置，缺少Bot Token或Chat ID');
      return false;
    }

    console.log('[Telegram] 開始傳送通知到 Chat ID: ' + config.TG_CHAT_ID);

    const url = 'https://api.telegram.org/bot' + config.TG_BOT_TOKEN + '/sendMessage';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.TG_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();
    console.log('[Telegram] 傳送結果:', result);
    return result.ok;
  } catch (error) {
    console.error('[Telegram] 傳送通知失敗:', error);
    return false;
  }
}

async function sendNotifyXNotification(title, content, description, config) {
  try {
    if (!config.NOTIFYX_API_KEY) {
      console.error('[NotifyX] 通知未配置，缺少API Key');
      return false;
    }

    console.log('[NotifyX] 開始傳送通知: ' + title);

    const url = 'https://www.notifyx.cn/api/v1/send/' + config.NOTIFYX_API_KEY;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        content: content,
        description: description || ''
      })
    });

    const result = await response.json();
    console.log('[NotifyX] 傳送結果:', result);
    return result.status === 'queued';
  } catch (error) {
    console.error('[NotifyX] 傳送通知失敗:', error);
    return false;
  }
}

async function sendBarkNotification(title, content, config) {
  try {
    if (!config.BARK_DEVICE_KEY) {
      console.error('[Bark] 通知未配置，缺少裝置Key');
      return false;
    }

    console.log('[Bark] 開始傳送通知到裝置: ' + config.BARK_DEVICE_KEY);

    const serverUrl = config.BARK_SERVER || 'https://api.day.app';
    const url = serverUrl + '/push';
    const payload = {
      title: title,
      body: content,
      device_key: config.BARK_DEVICE_KEY
    };

    // 如果配置了儲存推送，則新增isArchive引數
    if (config.BARK_IS_ARCHIVE === 'true') {
      payload.isArchive = 1;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log('[Bark] 傳送結果:', result);
    
    // Bark API返回code為200表示成功
    return result.code === 200;
  } catch (error) {
    console.error('[Bark] 傳送通知失敗:', error);
    return false;
  }
}

async function sendEmailNotification(title, content, config) {
  try {
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM || !config.EMAIL_TO) {
      console.error('[郵件通知] 通知未配置，缺少必要引數');
      return false;
    }

    console.log('[郵件通知] 開始傳送郵件到: ' + config.EMAIL_TO);

    // 生成HTML郵件內容
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
        text: content // 純文字備用
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

async function sendNotification(title, content, description, config) {
  if (config.NOTIFICATION_TYPE === 'notifyx') {
    return await sendNotifyXNotification(title, content, description, config);
  } else {
    return await sendTelegramNotification(content, config);
  }
}

// 4. 修改定時任務 checkExpiringSubscriptions，支援農曆週期自動續訂和農曆提醒
async function checkExpiringSubscriptions(env) {
  try {
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);
    console.log('[定時任務] 開始檢查即將到期的訂閱 UTC: ' + new Date().toISOString() + ', ' + timezone + ': ' + currentTime.toLocaleString('zh-CN', {timeZone: timezone}));

    const currentMidnight = getTimezoneMidnightTimestamp(currentTime, timezone); // 統一計算當天的零點時間，避免多次格式化

    const rawNotificationHours = Array.isArray(config.NOTIFICATION_HOURS) ? config.NOTIFICATION_HOURS : [];
    const normalizedNotificationHours = rawNotificationHours
      .map(value => String(value).trim())
      .filter(value => value.length > 0)
      .map(value => value === '*' ? '*' : value.toUpperCase() === 'ALL' ? 'ALL' : value.padStart(2, '0'));
    const allowAllHours = normalizedNotificationHours.includes('*') || normalizedNotificationHours.includes('ALL');
    const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, hour: '2-digit' });
    const currentHour = hourFormatter.format(currentTime);
    const shouldNotifyThisHour = allowAllHours || normalizedNotificationHours.length === 0 || normalizedNotificationHours.includes(currentHour);

    const subscriptions = await getAllSubscriptions(env);
    console.log('[定時任務] 共找到 ' + subscriptions.length + ' 個訂閱');
    const expiringSubscriptions = [];
    const updatedSubscriptions = [];
    let hasUpdates = false;

for (const subscription of subscriptions) {
  if (subscription.isActive === false) {
    console.log('[定時任務] 訂閱 "' + subscription.name + '" 已停用，跳過');
    continue;
  }

  const reminderSetting = resolveReminderSetting(subscription);
  let diffMs = 0;
  let diffHours = 0;
  let daysDiff;
  if (subscription.useLunar) {
    const expiryDate = new Date(subscription.expiryDate);
    let lunar = lunarCalendar.solar2lunar(
      expiryDate.getFullYear(),
      expiryDate.getMonth() + 1,
      expiryDate.getDate()
    );
    const solar = lunarBiz.lunar2solar(lunar);
    const lunarDate = new Date(solar.year, solar.month - 1, solar.day);
    const lunarMidnight = getTimezoneMidnightTimestamp(lunarDate, timezone);
    
    daysDiff = Math.round((lunarMidnight - currentMidnight) / MS_PER_DAY);

    console.log('[定時任務] 訂閱 "' + subscription.name + '" 到期日期: ' + expiryDate.toISOString() + ', 農曆轉換後午夜時間: ' + new Date(lunarMidnight).toISOString() + ', 剩餘天數: ' + daysDiff);

    diffMs = expiryDate.getTime() - currentTime.getTime();
    diffHours = diffMs / MS_PER_HOUR;

    if (daysDiff < 0 && subscription.periodValue && subscription.periodUnit && subscription.autoRenew !== false) {
      let nextLunar = lunar;
      do {
        nextLunar = lunarBiz.addLunarPeriod(nextLunar, subscription.periodValue, subscription.periodUnit);
        const solar = lunarBiz.lunar2solar(nextLunar);
        var newExpiryDate = new Date(solar.year, solar.month - 1, solar.day);
        const newLunarMidnight = getTimezoneMidnightTimestamp(newExpiryDate, timezone);
        daysDiff = Math.round((newLunarMidnight - currentMidnight) / MS_PER_DAY);
        console.log('[定時任務] 訂閱 "' + subscription.name + '" 更新到期日期: ' + newExpiryDate.toISOString() + ', 農曆轉換後午夜時間: ' + new Date(newLunarMidnight).toISOString() + ', 剩餘天數: ' + daysDiff);
      } while (daysDiff < 0);

      diffMs = newExpiryDate.getTime() - currentTime.getTime();
      diffHours = diffMs / MS_PER_HOUR;

      const updatedSubscription = { ...subscription, expiryDate: newExpiryDate.toISOString() };
      updatedSubscriptions.push(updatedSubscription);
      hasUpdates = true;

      const shouldRemindAfterRenewal = shouldTriggerReminder(reminderSetting, daysDiff, diffHours);
      if (shouldRemindAfterRenewal) {
        console.log('[定時任務] 訂閱 "' + subscription.name + '" 在提醒範圍內，將傳送通知');
        expiringSubscriptions.push({
          ...updatedSubscription,
          daysRemaining: daysDiff,
          hoursRemaining: Math.round(diffHours)
        });
      }
      continue;
    }
  } else {
    const expiryDate = new Date(subscription.expiryDate);
    const expiryMidnight = getTimezoneMidnightTimestamp(expiryDate, timezone);

    daysDiff = Math.round((expiryMidnight - currentMidnight) / MS_PER_DAY);

    console.log('[定時任務] 訂閱 "' + subscription.name + '" 到期日期: ' + expiryDate.toISOString() + ', 時區午夜時間: ' + new Date(expiryMidnight).toISOString() + ', 剩餘天數: ' + daysDiff);

    diffMs = expiryDate.getTime() - currentTime.getTime();
    diffHours = diffMs / MS_PER_HOUR;

    if (daysDiff < 0 && subscription.periodValue && subscription.periodUnit && subscription.autoRenew !== false) {
      const newExpiryDate = new Date(expiryDate);

      if (subscription.periodUnit === 'day') {
        newExpiryDate.setDate(expiryDate.getDate() + subscription.periodValue);
      } else if (subscription.periodUnit === 'month') {
        newExpiryDate.setMonth(expiryDate.getMonth() + subscription.periodValue);
      } else if (subscription.periodUnit === 'year') {
        newExpiryDate.setFullYear(expiryDate.getFullYear() + subscription.periodValue);
      }

      let newExpiryMidnight = getTimezoneMidnightTimestamp(newExpiryDate, timezone);
      while (newExpiryMidnight < currentMidnight) {
        console.log('[定時任務] 新計算的到期日期 ' + newExpiryDate.toISOString() + ' (時區轉換後午夜: ' + new Date(newExpiryMidnight).toISOString() + ') 仍然過期，繼續計算下一個週期');
        if (subscription.periodUnit === 'day') {
          newExpiryDate.setDate(newExpiryDate.getDate() + subscription.periodValue);
        } else if (subscription.periodUnit === 'month') {
          newExpiryDate.setMonth(newExpiryDate.getMonth() + subscription.periodValue);
        } else if (subscription.periodUnit === 'year') {
          newExpiryDate.setFullYear(newExpiryDate.getFullYear() + subscription.periodValue);
        }
        newExpiryMidnight = getTimezoneMidnightTimestamp(newExpiryDate, timezone);
      }

      console.log('[定時任務] 訂閱 "' + subscription.name + '" 更新到期日期: ' + newExpiryDate.toISOString());

      diffMs = newExpiryDate.getTime() - currentTime.getTime();
      diffHours = diffMs / MS_PER_HOUR;

      const updatedSubscription = { ...subscription, expiryDate: newExpiryDate.toISOString() };
      updatedSubscriptions.push(updatedSubscription);
      hasUpdates = true;

      const newDaysDiff = Math.round((newExpiryMidnight - currentMidnight) / MS_PER_DAY);
      const shouldRemindAfterRenewal = shouldTriggerReminder(reminderSetting, newDaysDiff, diffHours);
      if (shouldRemindAfterRenewal) {
        console.log('[定時任務] 訂閱 "' + subscription.name + '" 在提醒範圍內，將傳送通知');
        expiringSubscriptions.push({
          ...updatedSubscription,
          daysRemaining: newDaysDiff,
          hoursRemaining: Math.round(diffHours)
        });
      }
      continue;
    }
  }

  diffMs = new Date(subscription.expiryDate).getTime() - currentTime.getTime();
  diffHours = diffMs / MS_PER_HOUR;
  const shouldRemind = shouldTriggerReminder(reminderSetting, daysDiff, diffHours);

  if (daysDiff < 0 && subscription.autoRenew === false) {
    console.log('[定時任務] 訂閱 "' + subscription.name + '" 已過期且未啟用自動續訂，將傳送過期通知');
    expiringSubscriptions.push({
      ...subscription,
      daysRemaining: daysDiff,
      hoursRemaining: Math.round(diffHours)
    });
  } else if (shouldRemind) {
    console.log('[定時任務] 訂閱 "' + subscription.name + '" 在提醒範圍內，將傳送通知');
    expiringSubscriptions.push({
      ...subscription,
      daysRemaining: daysDiff,
      hoursRemaining: Math.round(diffHours)
    });
  }
}

    if (hasUpdates) {
      const mergedSubscriptions = subscriptions.map(sub => {
        const updated = updatedSubscriptions.find(u => u.id === sub.id);
        return updated || sub;
      });
      await env.SUBSCRIPTIONS_KV.put('subscriptions', JSON.stringify(mergedSubscriptions));
    }

    if (expiringSubscriptions.length > 0) {
      if (!shouldNotifyThisHour) {
        console.log('[定時任務] 當前小時 ' + currentHour + ' 未配置為推送時間，跳過傳送通知');
        expiringSubscriptions.length = 0;
      } else {
        // 按到期時間排序
        expiringSubscriptions.sort((a, b) => a.daysRemaining - b.daysRemaining);

        // 使用最佳化的格式化函式
        const commonContent = formatNotificationContent(expiringSubscriptions, config);
        const metadataTags = extractTagsFromSubscriptions(expiringSubscriptions);

        const title = '訂閱到期提醒';
        await sendNotificationToAllChannels(title, commonContent, config, '[定時任務]', {
          metadata: { tags: metadataTags }
        });
      }
    }
  } catch (error) {
    console.error('[定時任務] 檢查即將到期的訂閱失敗:', error);
  }
}

function getCookieValue(cookieString, key) {
  if (!cookieString) return null;

  const match = cookieString.match(new RegExp('(^| )' + key + '=([^;]+)'));
  return match ? match[2] : null;
}

async function handleRequest(request, env, ctx) {
  return new Response(loginPage, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

const CryptoJS = {
  HmacSHA256: function(message, key) {
    const keyData = new TextEncoder().encode(key);
    const messageData = new TextEncoder().encode(message);

    return Promise.resolve().then(() => {
      return crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: {name: "SHA-256"} },
        false,
        ["sign"]
      );
    }).then(cryptoKey => {
      return crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        messageData
      );
    }).then(buffer => {
      const hashArray = Array.from(new Uint8Array(buffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    });
  }
};

function getCurrentTime(config) {
  const timezone = config?.TIMEZONE || 'UTC';
  const currentTime = getCurrentTimeInTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return {
    date: currentTime,
    localString: formatter.format(currentTime),
    isoString: currentTime.toISOString()
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 新增除錯頁面
    if (url.pathname === '/debug') {
      try {
        const config = await getConfig(env);
        const debugInfo = {
          timestamp: new Date().toISOString(), // 使用UTC時間戳
          pathname: url.pathname,
          kvBinding: !!env.SUBSCRIPTIONS_KV,
          configExists: !!config,
          adminUsername: config.ADMIN_USERNAME,
          hasJwtSecret: !!config.JWT_SECRET,
          jwtSecretLength: config.JWT_SECRET ? config.JWT_SECRET.length : 0
        };

        return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>除錯資訊</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #f5f5f5; }
    .info { background: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .success { color: green; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>系統除錯資訊</h1>
  <div class="info">
    <h3>基本資訊</h3>
    <p>時間: ${debugInfo.timestamp}</p>
    <p>路徑: ${debugInfo.pathname}</p>
    <p class="${debugInfo.kvBinding ? 'success' : 'error'}">KV繫結: ${debugInfo.kvBinding ? '✓' : '✗'}</p>
  </div>

  <div class="info">
    <h3>配置資訊</h3>
    <p class="${debugInfo.configExists ? 'success' : 'error'}">配置存在: ${debugInfo.configExists ? '✓' : '✗'}</p>
    <p>管理員使用者名稱: ${debugInfo.adminUsername}</p>
    <p class="${debugInfo.hasJwtSecret ? 'success' : 'error'}">JWT金鑰: ${debugInfo.hasJwtSecret ? '✓' : '✗'} (長度: ${debugInfo.jwtSecretLength})</p>
  </div>

  <div class="info">
    <h3>解決方案</h3>
    <p>1. 確保KV名稱空間已正確繫結為 SUBSCRIPTIONS_KV</p>
    <p>2. 嘗試訪問 <a href="/">/</a> 進行登入</p>
    <p>3. 如果仍有問題，請檢查Cloudflare Workers日誌</p>
  </div>
</body>
</html>`, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } catch (error) {
        return new Response(`除錯頁面錯誤: ${error.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    }

    if (url.pathname.startsWith('/api')) {
      return api.handleRequest(request, env, ctx);
    } else if (url.pathname.startsWith('/admin')) {
      return admin.handleRequest(request, env, ctx);
    } else {
      return handleRequest(request, env, ctx);
    }
  },

  async scheduled(event, env, ctx) {
    const config = await getConfig(env);
    const timezone = config?.TIMEZONE || 'UTC';
    const currentTime = getCurrentTimeInTimezone(timezone);
    console.log('[Workers] 定時任務觸發 UTC:', new Date().toISOString(), timezone + ':', currentTime.toLocaleString('zh-CN', {timeZone: timezone}));
    await checkExpiringSubscriptions(env);
  }
};
