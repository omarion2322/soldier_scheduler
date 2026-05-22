/**
 * Soldier Scheduler — Google Apps Script backend.
 *
 * Deploy:
 *   1. Open https://script.google.com and create a new project.
 *   2. Paste this file's contents into Code.gs.
 *   3. SHEET_ID below is already set to the project sheet.
 *   4. Each submitted week is written to its own tab named e.g. "Week 1 (May 26-Jun 1)".
 *      Tabs are created automatically on first submission for that week.
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

const SHEET_ID = '1RQEXiMVyHqXV75j_gm0qT_1QobtC-TtNrwDxCYxyf2Q';
const TIMEZONE = 'Asia/Jerusalem';

const SCHEDULE_START_ISO = '2026-05-26';
const SCHEDULE_END_ISO = '2026-07-18';

const HEADERS = [
  'submittedAt',
  'phone',
  'name',
  'position',
  'weekStart',
  'date',
  'slot',
  'state',
  'unavailableDay',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function addDaysIso_(iso, n) {
  const parts = iso.split('-');
  const dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return yy + '-' + mm + '-' + dd;
}

function formatMonthDay_(iso) {
  const parts = iso.split('-');
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  return MONTHS[m] + ' ' + d;
}

function weekIndexFor_(weekStart) {
  // Returns 1-based index, or 0 if invalid.
  if (weekStart < SCHEDULE_START_ISO || weekStart > SCHEDULE_END_ISO) return 0;
  const a = new Date(SCHEDULE_START_ISO + 'T00:00:00Z').getTime();
  const b = new Date(weekStart + 'T00:00:00Z').getTime();
  const diffDays = Math.round((b - a) / 86400000);
  if (diffDays < 0 || diffDays % 7 !== 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}

function tabNameFor_(weekStart) {
  const idx = weekIndexFor_(weekStart);
  if (!idx) return '';
  const fullEnd = addDaysIso_(weekStart, 6);
  const end = fullEnd <= SCHEDULE_END_ISO ? fullEnd : SCHEDULE_END_ISO;
  return 'Week ' + idx + ' (' + formatMonthDay_(weekStart) + '-' + formatMonthDay_(end) + ')';
}

function getWeekSheet_(weekStart) {
  const name = tabNameFor_(weekStart);
  if (!name) return null;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
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
    const position = String(body.position || '').trim();
    const weekStart = String(body.weekStart || '');

    const VALID_POSITIONS = { sambatz: true, mefaked_haml: true };
    if (!phone || !name || !weekStart || !VALID_POSITIONS[position]) {
      return jsonResponse_({ ok: false, reason: 'invalid' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return jsonResponse_({ ok: false, reason: 'invalid' });
    }
    if (!weekIndexFor_(weekStart)) {
      return jsonResponse_({ ok: false, reason: 'invalid' });
    }
    if (isPastDeadline_(weekStart)) {
      return jsonResponse_({ ok: false, reason: 'deadline_passed' });
    }

    const VALID_SLOTS = { morning: true, afternoon: true, night: true };
    const VALID_STATES = { can: true, cant: true };
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

    const sheet = getWeekSheet_(weekStart);
    if (!sheet) return jsonResponse_({ ok: false, reason: 'invalid' });

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
          rows.push([submittedAt, phone, name, position, weekStart, date, slot, state, '']);
        });
      });
      (body.unavailableDays || []).forEach(function (d) {
        if (ISO_DATE.test(String(d))) {
          rows.push([submittedAt, phone, name, position, weekStart, '', '', '', d]);
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
  const sheet = getWeekSheet_(weekStart);
  if (!sheet) return null;
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const values = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();

  // Column order: submittedAt, phone, name, position, weekStart, date, slot, state, unavailableDay
  const matching = values.filter(function (row) {
    return String(row[1]) === phone && String(row[4]) === weekStart;
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
  let position = '';
  latest.forEach(function (row) {
    name = String(row[2]) || name;
    position = String(row[3]) || position;
    const date = String(row[5]);
    const slot = String(row[6]);
    const state = String(row[7]);
    const unavail = String(row[8]);
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
    position: position,
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
    if (String(values[i][1]) === phone && String(values[i][4]) === weekStart) {
      sheet.deleteRow(i + 2);
    }
  }
}

function isPastDeadline_(weekStart) {
  // weekStart is a Tuesday (YYYY-MM-DD). Deadline = weekStart + 5 days at 00:00 local.
  const nowLocal = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  const deadline = addDaysIso_(weekStart, 5);
  return nowLocal >= deadline;
}
