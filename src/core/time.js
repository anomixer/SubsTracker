// @ts-check
/**
 * 時區核心模組
 *
 * ── 設計原則 ────────────────────────────────────────────────
 * 1. 數據儲存層：所有日期一律 ISO 8601 UTC 字串（如 "2026-05-24T17:30:00.000Z"）
 * 2. 業務邏輯層：判斷"通知時段""剩餘天數"前先把 UTC 時刻轉到使用者配置的時區下取
 *    年/月/日/時；本模組是這層的"唯一真相源"
 * 3. 展示層：所有面向使用者的日期顯示都走 formatLocalDate / formatTimezoneDisplay
 *
 * ── 關鍵設計 ────────────────────────────────────────────
 * - 舊 getCurrentTimeInTimezone() 只 `return new Date()`，把"當前 UTC 時刻"
 *   偽裝成"使用者本地時間"物件返回；呼叫方把它當作時區相關 Date 用，導致
 *   嚴重誤用（#52 / #91 / #166）。本版本改為：
 *   - 保留 getCurrentTimeInTimezone(tz) 作為相容 wrapper（返回原生 Date 即 UTC 時刻）
 *   - 新增 getNowInTimezone(tz) 返回結構體 {utc, parts, hourString, isoLocal}
 *     強制呼叫方顯式選擇"我要的是 UTC 時刻"還是"使用者 TZ 下的欄位"
 * - 新增 getDaysBetween(fromIso, toIso, tz) 基於"使用者 TZ 各自零點"算整天數差，
 *   修復"凌晨 0–8 點建立訂閱預設日期變前一天"的 #166
 * - 所有公開函數 JSDoc 標註 + 中文用途說明，從此可被 // @ts-check 守護
 *
 */

/** 一小時的毫秒數 */
export const MS_PER_HOUR = 1000 * 60 * 60;
/** 一天的毫秒數 */
export const MS_PER_DAY = MS_PER_HOUR * 24;

/**
 * @typedef {Object} TimezoneDateParts 時區下的日期分量
 * @property {number} year 年（4 位整數）
 * @property {number} month 月（1-12）
 * @property {number} day 日（1-31）
 * @property {number} hour 時（0-23）
 * @property {number} minute 分（0-59）
 * @property {number} second 秒（0-59）
 */

/**
 * @typedef {Object} TimezoneNow 當前時刻在某時區下的完整快照
 * @property {Date} utc 原生 Date（UTC 時刻，等價於 new Date()）
 * @property {TimezoneDateParts} parts 該時刻在 timezone 下的年月日時分秒
 * @property {string} hourString parts.hour 的兩位字串（如 "08"），排程器對比通知時段直接用它
 * @property {string} isoLocal "YYYY-MM-DDTHH:mm:ss" 本地表示（不帶時區後綴，用於展示）
 * @property {string} timezone 實際生效的時區（無效時回退 'UTC'）
 */

/**
 * 判斷字串是否為 IANA 合法時區。
 *
 * @param {string} timezone
 * @returns {boolean}
 */
export function isValidTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 兜底獲取一個安全可用的時區字串。
 *
 * @param {string=} timezone 使用者傳入的時區
 * @returns {string} 合法 IANA 時區，非法時返回 'UTC'
 */
function safeTimezone(timezone) {
  if (timezone && isValidTimezone(timezone)) return timezone;
  return 'UTC';
}

/**
 * 將一個 Date / ISO 字串 / 時間戳分解為目標時區下的年月日時分秒。
 *
 * 內部用 Intl.DateTimeFormat（en-US 12h=false）解析，無 DST/夏令時手算坑。
 *
 * @param {Date | string | number} date
 * @param {string} [timezone='UTC']
 * @returns {TimezoneDateParts}
 */
export function getTimezoneDateParts(date, timezone = 'UTC') {
  const tz = safeTimezone(timezone);
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    // 無效輸入，返回當前時間作為兜底
    return getTimezoneDateParts(new Date(), tz);
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const parts = formatter.formatToParts(d);
    const pick = (type) => {
      const part = parts.find((item) => item.type === type);
      return part ? Number(part.value) : 0;
    };
    let hour = pick('hour');
    // Intl 在某些 runtime 把 24 顯示為 0/24 不一致，歸一化到 0–23
    if (hour === 24) hour = 0;
    return {
      year: pick('year'),
      month: pick('month'),
      day: pick('day'),
      hour,
      minute: pick('minute'),
      second: pick('second')
    };
  } catch (error) {
    console.error(`解析時區(${timezone})失敗: ${error.message}`);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds()
    };
  }
}

/**
 * 獲取"當前時刻"在指定時區下的完整快照。
 *
 * 業務代碼請優先使用本函數而非 `getCurrentTimeInTimezone`，
 * 因為本函數明確告訴你：
 * - utc：UTC 原生 Date（用於持久化、計算時間差）
 * - parts.hour：你設置的時區下的當前小時（用於通知時段判斷）
 * - hourString：直接拿來和 NOTIFICATION_HOURS 字串陣列比較
 *
 * @param {string} [timezone='UTC']
 * @param {Date} [now] 可選注入當前時間（測試用）
 * @returns {TimezoneNow}
 */
export function getNowInTimezone(timezone = 'UTC', now) {
  const tz = safeTimezone(timezone);
  const utc = now instanceof Date ? new Date(utcMillis(now)) : new Date();
  const parts = getTimezoneDateParts(utc, tz);
  const hourString = String(parts.hour).padStart(2, '0');
  const isoLocal = formatPartsAsIsoLocal(parts);
  return { utc, parts, hourString, isoLocal, timezone: tz };
}

/**
 * 獲取指定時刻在某時區下的小時（兩位字串）。
 *
 * 排程器判斷"現在是不是允許發送通知的小時"專用。
 *
 * @param {Date | string | number} [date]
 * @param {string} [timezone='UTC']
 * @returns {string} "00" – "23"
 */
export function getTimezoneHourString(date, timezone = 'UTC') {
  const d = date == null ? new Date() : date;
  const parts = getTimezoneDateParts(d, timezone);
  return String(parts.hour).padStart(2, '0');
}

/**
 * 計算 from → to 在指定時區下"跨過幾個本地零點"的整天數。
 *
 * 例：
 *   from = "2026-05-24T16:00:00Z"  to = "2026-05-25T16:00:00Z"  tz=UTC
 *   → 1 天
 *
 *   from = "2026-05-24T16:00:00Z"  to = "2026-05-25T16:00:00Z"  tz=Asia/Taipei
 *   → 1 天（本地 24:00 → 次日 00:00）
 *
 *   from = "2026-05-24T20:00:00Z"  to = "2026-05-24T22:00:00Z"  tz=Asia/Taipei
 *   → 0 天（本地 04:00 → 06:00 同一天）
 *
 * 當 to < from 時返回負數。
 *
 * @param {Date | string | number} from
 * @param {Date | string | number} to
 * @param {string} [timezone='UTC']
 * @returns {number}
 */
export function getDaysBetween(from, to, timezone = 'UTC') {
  const tz = safeTimezone(timezone);
  const fromMid = getTimezoneMidnightTimestamp(from, tz);
  const toMid = getTimezoneMidnightTimestamp(to, tz);
  return Math.round((toMid - fromMid) / MS_PER_DAY);
}

/**
 * 計算指定時刻在某時區下的"零點"對應的 UTC 時間戳。
 *
 * 例：date=2026-05-24T15:30:00Z, tz=Asia/Taipei → 2026-05-24 23:30 臺北時間
 *     → 該日臺北零點 = 2026-05-24T16:00:00Z (因為臺北 00:00 = UTC 前一天 16:00)
 *     → 返回 1748015200000
 *
 * @param {Date | string | number} date
 * @param {string} [timezone='UTC']
 * @returns {number} UTC ms 時間戳
 */
export function getTimezoneMidnightTimestamp(date, timezone = 'UTC') {
  const tz = safeTimezone(timezone);
  const { year, month, day } = getTimezoneDateParts(date, tz);
  // 透過反推：tz 下 (year,month,day) 0:00 對應的 UTC 時刻
  // 算法：構造一個臨時 UTC 時刻 t0 = Date.UTC(year,month-1,day), 求它在 tz 下的偏移分鐘數 offsetMin,
  //      則 tz 下零點的 UTC ms = t0 - offsetMin*60_000
  const t0 = Date.UTC(year, month - 1, day, 0, 0, 0);
  const probeParts = getTimezoneDateParts(new Date(t0), tz);
  const probeAsUtc = Date.UTC(
    probeParts.year,
    probeParts.month - 1,
    probeParts.day,
    probeParts.hour,
    probeParts.minute,
    probeParts.second
  );
  const offsetMs = probeAsUtc - t0;
  return t0 - offsetMs;
}

/**
 * 把日期分量拼成 "YYYY-MM-DDTHH:mm:ss" 本地表示。
 *
 * @param {TimezoneDateParts} parts
 * @returns {string}
 */
function formatPartsAsIsoLocal(parts) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/**
 * 把日期分量拼成 "YYYY-MM-DD"。
 *
 * @param {{ year: number, month: number, day: number }} parts
 * @returns {string}
 */
function formatPartsAsDateOnly(parts) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * 把 Date 轉成 UTC ms 整數（相容 Date 與時間戳）。
 *
 * @param {Date | number} d
 * @returns {number}
 */
function utcMillis(d) {
  return d instanceof Date ? d.getTime() : Number(d);
}

/**
 * 根據目標時區下的本地日期分量，反推對應的 UTC 時間戳。
 *
 * @param {{ year: number, month: number, day: number, hour?: number, minute?: number, second?: number }} parts
 * @param {string} [timezone='UTC']
 * @returns {number}
 */
export function getTimestampForTimezoneParts(parts, timezone = 'UTC') {
  const tz = safeTimezone(timezone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);

  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day ||
    probe.getUTCHours() !== hour ||
    probe.getUTCMinutes() !== minute ||
    probe.getUTCSeconds() !== second
  ) {
    return Number.NaN;
  }

  const t0 = probe.getTime();
  const probeParts = getTimezoneDateParts(probe, tz);
  const probeAsUtc = Date.UTC(
    probeParts.year,
    probeParts.month - 1,
    probeParts.day,
    probeParts.hour,
    probeParts.minute,
    probeParts.second
  );
  const offsetMs = probeAsUtc - t0;
  return t0 - offsetMs;
}

/**
 * 以指定時區的本地零點解釋 "YYYY-MM-DD" 日期輸入。
 *
 * 若輸入是完整 ISO / 時間戳，則保持其絕對時刻語義直接解析。
 *
 * @param {Date | string | number} value
 * @param {string} [timezone='UTC']
 * @returns {Date}
 */
export function parseDateInputInTimezone(value, timezone = 'UTC') {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const ts = getTimestampForTimezoneParts(
        {
          year: Number(match[1]),
          month: Number(match[2]),
          day: Number(match[3]),
          hour: 0,
          minute: 0,
          second: 0
        },
        timezone
      );
      return new Date(ts);
    }
  }
  return new Date(value);
}

/**
 * 把某個時刻格式化為指定時區下的日期輸入值 "YYYY-MM-DD"。
 *
 * @param {Date | string | number} value
 * @param {string} [timezone='UTC']
 * @returns {string}
 */
export function formatDateInputInTimezone(value, timezone = 'UTC') {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return formatPartsAsDateOnly(getTimezoneDateParts(d, timezone));
}

/**
 * 獲取指定時區下"今天"的 YYYY-MM-DD。
 *
 * @param {string} [timezone='UTC']
 * @param {Date} [now]
 * @returns {string}
 */
export function getTodayDateStringInTimezone(timezone = 'UTC', now) {
  const current = getNowInTimezone(timezone, now);
  return formatPartsAsDateOnly(current.parts);
}

/**
 * 在指定時區的本地日期語義下增加日/月/年週期，並返回新時刻（本地零點）。
 *
 * @param {Date | string | number} value
 * @param {number} amount
 * @param {'day'|'month'|'year'} unit
 * @param {string} [timezone='UTC']
 * @returns {Date}
 */
export function addCalendarPeriodInTimezone(value, amount, unit, timezone = 'UTC') {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return new Date(Number.NaN);

  const parts = getTimezoneDateParts(d, timezone);
  const temp = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  if (unit === 'day') {
    temp.setUTCDate(temp.getUTCDate() + amount);
  } else if (unit === 'month') {
    temp.setUTCMonth(temp.getUTCMonth() + amount);
  } else if (unit === 'year') {
    temp.setUTCFullYear(temp.getUTCFullYear() + amount);
  }

  const ts = getTimestampForTimezoneParts(
    {
      year: temp.getUTCFullYear(),
      month: temp.getUTCMonth() + 1,
      day: temp.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0
    },
    timezone
  );
  return new Date(ts);
}

/**
 * 在指定時區下格式化日期。
 *
 * 不同 fmt 用於：
 * - 'date'      → "2026/05/24"
 * - 'datetime'  → "2026/05/24 17:30:00"
 * - 'full'（默認）→ 帶星期等本地化完整字串
 * - 'isoLocal'  → "2026-05-24T17:30:00"（無時區後綴）
 *
 * @param {Date | string | number} time
 * @param {string} [timezone='UTC']
 * @param {'date'|'datetime'|'full'|'isoLocal'} [format='full']
 * @returns {string}
 */
export function formatLocalDate(time, timezone = 'UTC', format = 'full') {
  const tz = safeTimezone(timezone);
  const d = time instanceof Date ? time : new Date(time);
  if (Number.isNaN(d.getTime())) return '';

  if (format === 'isoLocal') {
    return formatPartsAsIsoLocal(getTimezoneDateParts(d, tz));
  }

  try {
    if (format === 'date') {
      return d.toLocaleDateString('zh-TW', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    }
    if (format === 'datetime') {
      return d.toLocaleString('zh-TW', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    }
    return d.toLocaleString('zh-TW', { timeZone: tz });
  } catch (error) {
    console.error(`時間格式化錯誤: ${error.message}`);
    return d.toISOString();
  }
}

/**
 * 同 formatLocalDate，保留原命名以相容老呼叫方。
 *
 * @param {Date | string | number} time
 * @param {string} [timezone='UTC']
 * @param {'date'|'datetime'|'full'|'isoLocal'} [format='full']
 * @returns {string}
 */
export function formatTimeInTimezone(time, timezone = 'UTC', format = 'full') {
  return formatLocalDate(time, timezone, format);
}

/**
 * 計算時區相對 UTC 的整小時偏移量（夏令時下取當前時刻偏移）。
 *
 * @param {string} [timezone='UTC']
 * @returns {number} 偏移小時數（如 +8 表示 UTC+8）
 */
export function getTimezoneOffset(timezone = 'UTC') {
  const tz = safeTimezone(timezone);
  try {
    const now = new Date();
    const parts = getTimezoneDateParts(now, tz);
    const zoned = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    // 用 `+ 0` 歸一化 -0 為 +0，避免 Object.is 比較時困擾
    return Math.round((zoned - now.getTime()) / MS_PER_HOUR) + 0;
  } catch (error) {
    console.error(`獲取時區偏移量錯誤: ${error.message}`);
    return 0;
  }
}

/**
 * 生成時區顯示文本。
 *
 * 例：formatTimezoneDisplay('Asia/Taipei') → "臺北時間 (UTC+8)"
 *
 * @param {string} [timezone='UTC']
 * @returns {string}
 */
export function formatTimezoneDisplay(timezone = 'UTC') {
  const tz = safeTimezone(timezone);
  try {
    const offset = getTimezoneOffset(tz);
    const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
    const names = {
      UTC: '世界標準時間',
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
    const cn = names[tz] || tz;
    return `${cn} (UTC${offsetStr})`;
  } catch (error) {
    console.error('格式化時區顯示失敗:', error);
    return tz;
  }
}

/**
 * 北京時間快捷格式化函數。
 *
 * @param {Date | string | number} [date=new Date()]
 * @param {'date'|'datetime'|'full'|'isoLocal'} [format='full']
 * @returns {string}
 */
export function formatBeijingTime(date = new Date(), format = 'full') {
  return formatLocalDate(date, 'Asia/Shanghai', format);
}

/**
 * 從請求中推斷時區：query > Header > Accept-Language。
 *
 * 注意：本版本前端展示用的是 config.TIMEZONE（使用者配置的時區），
 * 此函數主要用於 API 相容場景。
 *
 * @param {Request} request
 * @returns {string}
 */
export function extractTimezone(request) {
  try {
    const url = new URL(request.url);
    const tzParam = url.searchParams.get('timezone');
    if (tzParam && isValidTimezone(tzParam)) return tzParam;

    const tzHeader = request.headers.get('X-Timezone');
    if (tzHeader && isValidTimezone(tzHeader)) return tzHeader;

    const accept = request.headers.get('Accept-Language') || '';
    if (accept.includes('zh')) return 'Asia/Shanghai';
    if (accept.includes('en-US')) return 'America/New_York';
    if (accept.includes('en-GB')) return 'Europe/London';
  } catch {
    /* noop */
  }
  return 'UTC';
}

// ─────────────────────────────────────────────────────────────
// 相容層（僅供舊呼叫方使用，新代碼請用上面的 getNowInTimezone）
// ─────────────────────────────────────────────────────────────

/**
 * 相容老呼叫：返回當前 UTC 時刻的 Date。
 *
 * 老 API 名字誤導（"InTimezone"），但語義就是"當前時刻"。
 * 後續 Task 會把所有呼叫方遷移到 getNowInTimezone。
 *
 * @param {string} [timezone='UTC']
 * @returns {Date}
 */
export function getCurrentTimeInTimezone(timezone = 'UTC') {
  void timezone; // 僅佔位保持簽名；Date 本身就是 UTC 時刻
  return new Date();
}

/**
 * 相容老呼叫：返回當前 UTC ms 時間戳。
 *
 * @param {string} [timezone='UTC']
 * @returns {number}
 */
export function getTimestampInTimezone(timezone = 'UTC') {
  void timezone;
  return Date.now();
}

/**
 * 相容老呼叫：把 UTC 時刻"轉換到"目標時區。
 *
 * 注意：這是個語義陷阱——Date 本身永遠是 UTC 時刻（絕對時刻），
 * "轉到"另一個時區只影響顯示，不影響 Date 實例。本函數僅返回原 Date 拷貝。
 *
 * @param {Date | string | number} utcTime
 * @param {string} [timezone='UTC']
 * @returns {Date}
 */
export function convertUTCToTimezone(utcTime, timezone = 'UTC') {
  void timezone;
  return utcTime instanceof Date ? new Date(utcTime.getTime()) : new Date(utcTime);
}
