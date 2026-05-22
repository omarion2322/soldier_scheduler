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

const POSITION_LABELS_HE = { mefaked_haml: 'מפקד חמ״ל', sambatz: 'סמב״צ' };
const SHIFT_TIME_LABELS = {
  morning: '6:00-14:00',
  afternoon: '14:00-22:00',
  night: '22:00-6:00',
};
const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

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

function shiftsTabNameFor_(weekStart) {
  const idx = weekIndexFor_(weekStart);
  if (!idx) return '';
  const fullEnd = addDaysIso_(weekStart, 6);
  const end = fullEnd <= SCHEDULE_END_ISO ? fullEnd : SCHEDULE_END_ISO;
  return 'Week ' + idx + ' Shifts (' + formatMonthDay_(weekStart) + '-' + formatMonthDay_(end) + ')';
}

function isoToDDMM_(iso) {
  const parts = iso.split('-');
  return parts[2] + '/' + parts[1];
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
      headers.push(d.slice(5) + ' ' + slot);
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
    if (mode === 'dedupe') {
      const week = (e && e.parameter && e.parameter.week) || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !weekIndexFor_(week)) {
        return jsonResponse_({ ok: false, reason: 'invalid' });
      }
      const sheet = getWeekSheet_(week);
      if (!sheet) return jsonResponse_({ ok: false, reason: 'invalid' });
      const removed = dedupeAllPhones_(sheet);
      rebuildShiftsTab_(sheet, week);
      return jsonResponse_({ ok: true, removed: removed });
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
      dedupeAllPhones_(sheet);

      const submittedAt = new Date().toISOString();
      const row = [submittedAt, phone, name, position, weekStart];
      const shiftStates = [];
      days.forEach(function (d) {
        const day = shiftsIn[d] || {};
        SLOTS.forEach(function (slot) {
          let state = day[slot] || 'can';
          if (!VALID_STATES[state]) state = 'can';
          shiftStates.push(state);
          row.push(state === 'can' ? 1 : 0);
        });
      });
      const atHomeDays = Object.keys(unavailableSet).sort().join(', ');
      row.push(atHomeDays);

      const headers = buildHeaders_(weekStart);
      let targetRow = collapseRowsFor_(sheet, phone);
      if (!targetRow) targetRow = sheet.getLastRow() + 1;
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);

      const shiftCount = shiftStates.length;
      if (shiftCount > 0) {
        const shiftRange = sheet.getRange(targetRow, FIXED_HEADERS.length + 1, 1, shiftCount);
        const colors = [shiftStates.map(function (s) {
          return s === 'can' ? '#d9ead3' : '#f4cccc';
        })];
        shiftRange.setBackgrounds(colors);
        shiftRange.setHorizontalAlignment('center');
      }

      rebuildShiftsTab_(sheet, weekStart);
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
      const v = String(row[col]).trim();
      cells[slot] = (v === '0' || v === 'cant') ? 'cant' : 'can';
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

function dedupeAllPhones_(sheet) {
  // For every phone present in the sheet, keep only the row with the latest
  // submittedAt; delete the rest. Operates in-place. Returns the number of
  // rows deleted.
  const last = sheet.getLastRow();
  if (last < 3) return 0;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 2) return 0;
  const range = sheet.getRange(2, 1, last - 1, Math.max(lastCol, 2));
  const values = range.getValues();
  const display = range.getDisplayValues();
  const latestByPhone = {};
  for (let i = 0; i < values.length; i += 1) {
    const phone = (String(display[i][1] || '').replace(/\D/g, '')) ||
                  (String(values[i][1] || '').replace(/\D/g, ''));
    if (!phone) continue;
    const ts = String(values[i][0] || display[i][0] || '');
    const cur = latestByPhone[phone];
    if (!cur || ts > cur.ts) latestByPhone[phone] = { idx: i, ts: ts };
  }
  const keep = {};
  Object.keys(latestByPhone).forEach(function (p) { keep[latestByPhone[p].idx] = true; });
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const phone = (String(display[i][1] || '').replace(/\D/g, '')) ||
                  (String(values[i][1] || '').replace(/\D/g, ''));
    if (phone && !keep[i]) {
      sheet.deleteRow(i + 2);
      deleted += 1;
    }
  }
  return deleted;
}

function collapseRowsFor_(sheet, phone) {
  // Removes all but the first row whose phone column matches.
  // Returns the row index of the surviving row, or 0 if none.
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const display = sheet.getRange(2, 2, last - 1, 1).getDisplayValues();
  const raw = sheet.getRange(2, 2, last - 1, 1).getValues();
  const target = String(phone).replace(/\D/g, '');
  const matches = [];
  for (let i = 0; i < display.length; i += 1) {
    const d = String(display[i][0] || '').replace(/\D/g, '');
    const r = String(raw[i][0] || '').replace(/\D/g, '');
    if (target && (d === target || r === target)) matches.push(i + 2);
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
  const display = sheet.getRange(2, 2, last - 1, 1).getDisplayValues();
  const raw = sheet.getRange(2, 2, last - 1, 1).getValues();
  const target = String(phone).replace(/\D/g, '');
  for (let i = display.length - 1; i >= 0; i -= 1) {
    const d = String(display[i][0] || '').replace(/\D/g, '');
    const r = String(raw[i][0] || '').replace(/\D/g, '');
    if (target && (d === target || r === target)) {
      sheet.deleteRow(i + 2);
    }
  }
}

function rebuildShiftsTab_(dataSheet, weekStart) {
  const tabName = shiftsTabNameFor_(weekStart);
  if (!tabName) return;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) sheet = ss.insertSheet(tabName);
  sheet.clear();
  sheet.setHiddenGridlines(false);

  const days = weekDaysFor_(weekStart);
  const positions = ['mefaked_haml', 'sambatz'];

  // Build availability map: avail[day][slot][position] = [names...]
  const avail = {};
  days.forEach(function (d) {
    avail[d] = {};
    SLOTS.forEach(function (s) {
      avail[d][s] = {};
      positions.forEach(function (p) { avail[d][s][p] = []; });
    });
  });

  const last = dataSheet.getLastRow();
  if (last >= 2) {
    const headers = buildHeaders_(weekStart);
    const totalCols = headers.length;
    const rows = dataSheet.getRange(2, 1, last - 1, totalCols).getValues();
    const display = dataSheet.getRange(2, 1, last - 1, totalCols).getDisplayValues();
    const FIXED = FIXED_HEADERS.length;

    // Keep only the latest row per phone (by submittedAt).
    const latestByPhone = {};
    rows.forEach(function (r, i) {
      const phoneDigits =
        String(display[i][1] || '').replace(/\D/g, '') ||
        String(r[1] || '').replace(/\D/g, '');
      if (!phoneDigits) return;
      const ts = String(r[0] || display[i][0] || '');
      const cur = latestByPhone[phoneDigits];
      if (!cur || ts > cur.ts) {
        latestByPhone[phoneDigits] = { row: r, ts: ts };
      }
    });

    Object.keys(latestByPhone).forEach(function (p) {
      const r = latestByPhone[p].row;
      const name = String(r[2] || '').trim();
      const position = String(r[3] || '').trim();
      if (!name || positions.indexOf(position) === -1) return;
      days.forEach(function (d, dayIdx) {
        SLOTS.forEach(function (slot, slotIdx) {
          const v = String(r[FIXED + dayIdx * SLOTS.length + slotIdx]).trim();
          if (v === '1' || v === 'can') {
            avail[d][slot][position].push(name);
          }
        });
      });
    });
  }

  // Write blocks per day, stacked vertically.
  sheet.setRightToLeft(true);

  const COL_TIME = 1;
  const COL_MEFAKED = 2;
  const COL_SAMBATZ = 3;
  const TOTAL_COLS = 3;

  const COLOR_TITLE_BG = '#1f3a5f';
  const COLOR_TITLE_FG = '#ffffff';
  const COLOR_DAY_BG = '#2f5d8e';
  const COLOR_DAY_FG = '#ffffff';
  const COLOR_POS_BG = '#cfe2f3';
  const COLOR_TIME_BG = '#f3f3f3';
  const COLOR_BAND_A = '#ffffff';
  const COLOR_BAND_B = '#f8fafc';
  const COLOR_BORDER = '#9aa0a6';

  let curRow = 1;
  const idx = weekIndexFor_(weekStart);
  const fullEnd = addDaysIso_(weekStart, 6);
  const end = fullEnd <= SCHEDULE_END_ISO ? fullEnd : SCHEDULE_END_ISO;
  const titleText = 'שבוע ' + idx + ' — שיבוץ (' + isoToDDMM_(weekStart) + '–' + isoToDDMM_(end) + ')';

  const titleRange = sheet.getRange(curRow, 1, 1, TOTAL_COLS);
  titleRange.merge();
  titleRange.setValue(titleText);
  titleRange.setBackground(COLOR_TITLE_BG)
    .setFontColor(COLOR_TITLE_FG)
    .setFontWeight('bold')
    .setFontSize(16)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(curRow, 36);
  curRow += 1;

  sheet.setRowHeight(curRow, 8); // spacer
  curRow += 1;

  days.forEach(function (d) {
    const dayDate = new Date(d + 'T00:00:00Z');
    const dayName = DAY_NAMES_HE[dayDate.getUTCDay()];

    // Day header row (merged across all columns)
    const dayHeaderRange = sheet.getRange(curRow, 1, 1, TOTAL_COLS);
    dayHeaderRange.merge();
    dayHeaderRange.setValue('יום ' + dayName + ' · ' + isoToDDMM_(d));
    dayHeaderRange.setBackground(COLOR_DAY_BG)
      .setFontColor(COLOR_DAY_FG)
      .setFontWeight('bold')
      .setFontSize(13)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(curRow, 30);
    curRow += 1;

    // Position label row
    const posRange = sheet.getRange(curRow, 1, 1, TOTAL_COLS);
    posRange.setValues([['', POSITION_LABELS_HE.mefaked_haml, POSITION_LABELS_HE.sambatz]]);
    posRange.setBackground(COLOR_POS_BG)
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(curRow, 26);
    curRow += 1;

    const slotStartRow = curRow;
    SLOTS.forEach(function (slot, slotIdx) {
      const mefakedNames = avail[d][slot].mefaked_haml;
      const sambatzNames = avail[d][slot].sambatz;
      const rowValues = [[
        SHIFT_TIME_LABELS[slot],
        mefakedNames.join('\n'),
        sambatzNames.join('\n'),
      ]];
      const rowRange = sheet.getRange(curRow, 1, 1, TOTAL_COLS);
      rowRange.setValues(rowValues);
      rowRange.setVerticalAlignment('middle')
        .setHorizontalAlignment('center')
        .setWrap(true)
        .setFontSize(11);

      const bandColor = slotIdx % 2 === 0 ? COLOR_BAND_A : COLOR_BAND_B;
      sheet.getRange(curRow, COL_MEFAKED, 1, 2).setBackground(bandColor);
      sheet.getRange(curRow, COL_TIME)
        .setBackground(COLOR_TIME_BG)
        .setFontWeight('bold')
        .setFontSize(11);

      // Row height grows with the larger of the two name lists.
      const maxNames = Math.max(1, mefakedNames.length, sambatzNames.length);
      sheet.setRowHeight(curRow, Math.max(36, 18 + maxNames * 18));

      curRow += 1;
    });
    const slotEndRow = curRow - 1;

    // Border around the day block (day header + position labels + slot rows).
    const blockRange = sheet.getRange(curRow - SLOTS.length - 2, 1, SLOTS.length + 2, TOTAL_COLS);
    blockRange.setBorder(true, true, true, true, false, false, COLOR_BORDER,
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    // Inner horizontal separators between slot rows.
    sheet.getRange(slotStartRow, 1, SLOTS.length, TOTAL_COLS)
      .setBorder(null, null, null, null, false, true, '#dadce0',
        SpreadsheetApp.BorderStyle.SOLID);
    // Vertical separator between position columns.
    sheet.getRange(slotStartRow - 1, COL_MEFAKED, SLOTS.length + 1, 2)
      .setBorder(null, null, null, null, true, false, '#dadce0',
        SpreadsheetApp.BorderStyle.SOLID);

    sheet.setRowHeight(curRow, 10); // spacer between days
    curRow += 1;
  });

  sheet.setColumnWidth(COL_TIME, 130);
  sheet.setColumnWidth(COL_MEFAKED, 200);
  sheet.setColumnWidth(COL_SAMBATZ, 260);
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
}
