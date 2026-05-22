/**
 * Soldier Scheduler — Google Apps Script backend.
 *
 * Deploy:
 *   1. Open https://script.google.com and create a new project.
 *   2. Paste this file's contents into Code.gs.
 *   3. Create a Google Sheet; copy its ID into SHEET_ID below.
 *   4. The sheet must have a tab named "responses". On first run, headers are written.
 *   5. Deploy > New deployment > type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      Authorize the script. Copy the /exec URL into the frontend's VITE_API_URL.
 *
 * Endpoints:
 *   GET  ?phone=...&week=YYYY-MM-DD  -> { ok, submission|null }
 *   POST JSON Submission             -> { ok, reason? }
 *
 * The deadline is Sunday 00:00 Asia/Jerusalem of the submitted week.
 */

const SHEET_ID = 'PUT_YOUR_SHEET_ID_HERE';
const TAB_NAME = 'responses';
const TIMEZONE = 'Asia/Jerusalem';

const HEADERS = [
  'submittedAt',
  'phone',
  'name',
  'weekStart',
  'date',
  'slot',
  'state',
  'unavailableDay',
];

function getSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function doGet(e) {
  try {
    const phone = (e && e.parameter && e.parameter.phone) || '';
    const week = (e && e.parameter && e.parameter.week) || '';
    if (!phone || !week) {
      return jsonResponse_({ ok: false, reason: 'invalid' });
    }
    const submission = readSubmission_(phone, week);
    return jsonResponse_({ ok: true, submission: submission });
  } catch (err) {
    return jsonResponse_({ ok: false, reason: 'server_error', error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const phone = String(body.phone || '').replace(/\D/g, '');
    const name = String(body.name || '').trim();
    const weekStart = String(body.weekStart || '');
    if (!phone || !name || !weekStart) {
      return jsonResponse_({ ok: false, reason: 'invalid' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return jsonResponse_({ ok: false, reason: 'invalid' });
    }
    if (weekStart < '2026-05-26' || weekStart > '2026-07-18') {
      return jsonResponse_({ ok: false, reason: 'invalid' });
    }
    if (isPastDeadline_(weekStart)) {
      return jsonResponse_({ ok: false, reason: 'deadline_passed' });
    }

    const VALID_SLOTS = { morning: true, afternoon: true, night: true };
    const VALID_STATES = { can: true, cant: true };
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

    const sheet = getSheet_();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      deleteRowsFor_(sheet, phone, weekStart);

      const submittedAt = new Date().toISOString();
      const rows = [];
      const shifts = body.shifts || {};
      Object.keys(shifts).forEach(function (date) {
        if (!ISO_DATE.test(date)) return;
        const day = shifts[date] || {};
        ['morning', 'afternoon', 'night'].forEach(function (slot) {
          if (!VALID_SLOTS[slot]) return;
          let state = day[slot] || 'can';
          if (!VALID_STATES[state]) state = 'can';
          rows.push([submittedAt, phone, name, weekStart, date, slot, state, '']);
        });
      });
      (body.unavailableDays || []).forEach(function (d) {
        if (ISO_DATE.test(String(d))) {
          rows.push([submittedAt, phone, name, weekStart, '', '', '', d]);
        }
      });

      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      }
    } finally {
      lock.releaseLock();
    }

    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, reason: 'server_error', error: String(err) });
  }
}

function readSubmission_(phone, weekStart) {
  const sheet = getSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  const matching = values.filter(function (row) {
    return String(row[1]) === phone && String(row[3]) === weekStart;
  });
  if (matching.length === 0) return null;

  let latestSubmittedAt = '';
  matching.forEach(function (row) {
    const ts = String(row[0]);
    if (ts > latestSubmittedAt) latestSubmittedAt = ts;
  });
  const latest = matching.filter(function (row) {
    return String(row[0]) === latestSubmittedAt;
  });

  const shifts = {};
  const unavailableDays = [];
  let name = '';
  latest.forEach(function (row) {
    name = String(row[2]) || name;
    const date = String(row[4]);
    const slot = String(row[5]);
    const state = String(row[6]);
    const unavail = String(row[7]);
    if (unavail) {
      unavailableDays.push(unavail);
    } else if (date && slot) {
      if (!shifts[date]) shifts[date] = { morning: 'can', afternoon: 'can', night: 'can' };
      shifts[date][slot] = state;
    }
  });

  return {
    phone: phone,
    name: name,
    weekStart: weekStart,
    unavailableDays: unavailableDays,
    shifts: shifts,
    submittedAt: latestSubmittedAt,
  };
}

function deleteRowsFor_(sheet, phone, weekStart) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (String(values[i][1]) === phone && String(values[i][3]) === weekStart) {
      sheet.deleteRow(i + 2);
    }
  }
}

function isPastDeadline_(weekStart) {
  // weekStart is a Tuesday (YYYY-MM-DD). Deadline = weekStart + 5 days at 00:00 local.
  const parts = weekStart.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  // Build a Date representing midnight local Asia/Jerusalem on (weekStart + 5).
  // Apps Script uses the script's timezone; we use Utilities.formatDate to get current local date.
  const nowLocal = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const deadline = addDaysIso_(y, m, d, 5);
  return nowLocal >= deadline;
}

function addDaysIso_(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return yy + '-' + mm + '-' + dd;
}
