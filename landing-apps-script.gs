/**
 * קליטת לידים מדף הנחיתה (landing.html) לתוך Google Sheets
 *
 * התקנה:
 * 1. פתח Google Sheet חדש → תוספים (Extensions) → Apps Script
 * 2. הדבק את הקוד הזה במקום הקוד הקיים ושמור
 * 3. פריסה (Deploy) → פריסה חדשה → סוג: Web app
 *      Execute as: Me
 *      Who has access: Anyone
 * 4. אשר הרשאות, העתק את ה-URL שמתקבל (מסתיים ב-/exec)
 * 5. הדבק אותו ב-landing.html בשדה CONFIG.SHEETS_URL
 *
 * אחרי כל שינוי בקוד כאן צריך: Deploy → Manage deployments → Edit → New version
 */

const SHEET_NAME = 'לידים';
const COLUMNS = [
  'timestamp', 'name', 'phone', 'product', 'consent', 'page',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid',
];
const HEADERS = [
  'תאריך', 'שם', 'טלפון', 'מוצר', 'הסכמה לדיוור', 'עמוד',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const sheet = getSheet_();
    const row = COLUMNS.map(k => (k === 'timestamp' ? new Date() : sanitize_(data[k])));
    sheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.setRightToLeft(true);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// מונע הזרקת נוסחאות (=, +, -, @) לגיליון
function sanitize_(v) {
  if (v === undefined || v === null) return '';
  const s = String(v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
