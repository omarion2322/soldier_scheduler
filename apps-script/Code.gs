/**
 * Soldier Scheduler — Google Apps Script backend.
 *
 * Deploy:
 *   1. Open https://script.google.com and create a new project.
 *   2. Paste this file's contents into Code.gs.
 *   3. SHEET_ID below is already set to the project sheet.
 *   4. Each submitted week is written to its own tab named e.g. "Week 1 (May 26-Jun 1)".
 *      One row per soldier per week. Columns:
 *        submittedAt | phone | name | position | weekStart |
 *        <YYYY-MM-DD slot> for each (day, slot) in that week (15 or 21 cols) |
 *        atHomeDays
 *      Resubmissions overwrite the existing row for that phone.
 *      Tabs are created automatically; if a tab from an older format is detected
 *      the script wipes it and writes the new headers.
 *   5. Deploy > New deployment > type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *      Authorize the script. Copy the /exec URL into the frontend's VITE_API_URL.
 *
 * Endpoints:
 *   GET  ?phone=...&week=YYYY-MM-DD  -> { ok, submission|null }
 *   GET  ?mode=locks                 -> { ok, lockedWeeks: ['YYYY-MM-DD', ...] }
 *   POST JSON Submission             -> { ok, reason? }
 *
 * Locking weeks:
 *   Add a tab named "locks" to the spreadsheet. Column A header: weekStart.
 *   Each subsequent row holds a Tuesday YYYY-MM-DD that should be read-only.
 *   The script creates this tab automatically on first request if missing.
 */

const SHEET_ID = '1RQEXiMVyHqXV75j_gm0qT_1QobtC-TtNrwDxCYxyf2Q';
const LOCKS_TAB = 'locks';

const SCHEDULE_START_ISO = '2026-05-26';
const SCHEDULE_END_ISO = '2026-07-18';

const FIXED_HEADERS = ['submittedAt', 'phone', 'name', 'position', 'weekStart'];
const SLOTS = ['morning', 'afternoon', 'night'];
const TRAILING_HEADERS = ['atHomeDays'];

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

function weekDaysFor_(weekStart) {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = addDaysIso_(weekStart, i);
    if (d > SCHEDULE_END_ISO) break;
    days.push(d);
  }
  return days;
}

function buildHeaders_(weekStart) {
  const headers = FIXED_HEADERS.slice();
  weekDaysFor_(weekStart).forEach(function (d) {
    SLOTS.forEach(function (slot) {
      headers.push(d + ' ' + slot);
    });
  });
  return headers.concat(TRAILING_HEADERS);
}

function writeHeaders_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
}

function headersMatch_(sheet, headers) {
  const lastCol = sheet.getLastColumn();
  if (lastCol !== headers.length) return false;
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  for (let i = 0; i < headers.length; i += 1) {
    if (String(existing[i]) !== headers[i]) return false;
  }
  return true;
}

function getWeekSheet_(weekStart) {
  const name = tabNameFor_(weekStart);
  if (!name) return null;
  const headers = buildHeaders_(weekStart);
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    writeHeaders_(sheet, headers);
    return sheet;
  }
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    writeHeaders_(sheet, headers);
    return sheet;
  }
  if (!headersMatch_(sheet, headers)) {
    // Old format detected — wipe and re-init. Existing data in old format is dropped.
    sheet.clear();
    writeHeaders_(sheet, headers);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function getLocksSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(LOCKS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LOCKS_TAB);
    sheet.appendRow(['weekStart']);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(['weekStart']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getLockedWeeks_() {
  const sheet = getLocksSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return {};
  const values = sheet.getRange(2, 1, last - 1, 1).getValues();
  const set = {};
  values.forEach(function (row) {
    let v = row[0];
    if (v instanceof Date) {
      v = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
    } else {
      v = String(v).trim();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) set[v] = true;
  });
  return set;
}

function isWeekLocked_(weekStart) {
  return Boolean(getLockedWeeks_()[weekStart]);
}

function doGet(e) {
  try {
    const mode = (e && e.parameter && e.parameter.mode) || '';
    if (mode === 'locks') {
      return jsonResponse_({ ok: true, lockedWeeks: Object.keys(getLockedWeeks_()) });
    }
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
    if (isWeekLocked_(weekStart)) {
      return jsonResponse_({ ok: false, reason: 'locked' });
    }

    const VALID_STATES = { can: true, cant: true };
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

    const sheet = getWeekSheet_(weekStart);
    if (!sheet) return jsonResponse_({ ok: false, reason: 'invalid' });

    const days = weekDaysFor_(weekStart);
    const shiftsIn = body.shifts || {};
    const unavailableSet = {};
    (body.unavailableDays || []).forEach(function (d) {
      if (ISO_DATE.test(String(d))) unavailableSet[d] = true;
    });

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const submittedAt = new Date().toISOString();
      const row = [submittedAt, phone, name, position, weekStart];
      days.forEach(function (d) {
        const day = shiftsIn[d] || {};
        SLOTS.forEach(function (slot) {
          let state = day[slot] || 'can';
          if (!VALID_STATES[state]) state = 'can';
          row.push(state);
        });
      });
      const atHomeDays = Object.keys(unavailableSet).sort().join(', ');
      row.push(atHomeDays);

      const headers = buildHeaders_(weekStart);
      // Collapse any duplicate rows for this phone, then overwrite the single
      // remaining row in place (or append a new one if none existed).
      let targetRow = collapseRowsFor_(sheet, phone);
      if (!targetRow) targetRow = sheet.getLastRow() + 1;
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
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
  const headers = buildHeaders_(weekStart);
  const values = sheet.getRange(2, 1, last - 1, headers.length).getValues();

  // Column layout: submittedAt | phone | name | position | weekStart | <3*N slot cells> | atHomeDays
  let row = null;
  let latestTs = '';
  values.forEach(function (r) {
    const ts = String(r[0]);
    if (String(r[1]).trim() === String(phone).trim() && ts > latestTs) {
      row = r;
      latestTs = ts;
    }
  });
  if (!row) return null;

  const days = weekDaysFor_(weekStart);
  const shifts = {};
  let col = FIXED_HEADERS.length;
  days.forEach(function (d) {
    const cells = {};
    SLOTS.forEach(function (slot) {
      const v = String(row[col]);
      cells[slot] = v === 'cant' ? 'cant' : 'can';
      col += 1;
    });
    shifts[d] = cells;
  });
  const atHomeStr = String(row[col] || '');
  const unavailableDays = atHomeStr
    ? atHomeStr.split(',').map(function (s) { return s.trim(); })
        .filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); })
    : [];

  return {
    phone: phone,
    name: String(row[2]),
    position: String(row[3]),
    weekStart: weekStart,
    unavailableDays: unavailableDays,
    shifts: shifts,
    submittedAt: latestTs,
  };
}

function collapseRowsFor_(sheet, phone) {
  // Removes all but the first row whose phone column matches.
  // Returns the row index of the surviving row, or 0 if none.
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const phones = sheet.getRange(2, 2, last - 1, 1).getDisplayValues();
  const target = String(phone).trim();
  const matches = [];
  for (let i = 0; i < phones.length; i += 1) {
    if (String(phones[i][0]).trim() === target) matches.push(i + 2);
  }
  if (matches.length === 0) return 0;
  for (let j = matches.length - 1; j >= 1; j -= 1) {
    sheet.deleteRow(matches[j]);
  }
  return matches[0];
}

function deleteRowsFor_(sheet, phone) {
  const last = sheet.getLastRow();
  if (last < 2) return;
  const phones = sheet.getRange(2, 2, last - 1, 1).getDisplayValues();
  const target = String(phone).trim();
  for (let i = phones.length - 1; i >= 0; i -= 1) {
    if (String(phones[i][0]).trim() === target) {
      sheet.deleteRow(i + 2);
    }
  }
}
