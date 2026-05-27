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
const OVERALL_TAB = 'Overall Shifts';
const OVERALL_FIXED_HEADERS = ['phone', 'name', 'position', 'total'];

const SCHEDULE_START_ISO = '2026-05-28';
const SCHEDULE_END_ISO = '2026-07-16';

const FIXED_HEADERS = ['submittedAt', 'phone', 'name', 'position', 'weekStart'];
const SLOTS = ['morning', 'afternoon', 'night'];
const TRAILING_HEADERS = ['atHomeDays', 'reasons'];

const POSITION_LABELS_HE = { mefaked_haml: 'מפקד חמ״ל', sambatz: 'סמב״צ' };
const SHIFT_TIME_LABELS = {
  morning: '6:00-14:00',
  afternoon: '14:00-22:00',
  night: '22:00-6:00',
};
const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function canonPhone_(v) {
  const digits = String(v == null ? '' : v).replace(/\D/g, '');
  return digits.replace(/^0+/, '');
}

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
  // Reject would-be starts whose normal 7-day window overruns the schedule end
  // (these are absorbed into the previous week and are not real starts).
  if (addDaysIso_(weekStart, 6) > SCHEDULE_END_ISO) return 0;
  const a = new Date(SCHEDULE_START_ISO + 'T00:00:00Z').getTime();
  const b = new Date(weekStart + 'T00:00:00Z').getTime();
  const diffDays = Math.round((b - a) / 86400000);
  if (diffDays < 0 || diffDays % 7 !== 0) return 0;
  return Math.floor(diffDays / 7) + 1;
}

function weekEndFor_(weekStart) {
  let end = addDaysIso_(weekStart, 6);
  if (end > SCHEDULE_END_ISO) end = SCHEDULE_END_ISO;
  // Absorb a trailing short remainder into this week.
  if (end < SCHEDULE_END_ISO && addDaysIso_(end, 7) > SCHEDULE_END_ISO) {
    end = SCHEDULE_END_ISO;
  }
  return end;
}

function tabNameFor_(weekStart) {
  const idx = weekIndexFor_(weekStart);
  if (!idx) return '';
  const end = weekEndFor_(weekStart);
  return 'Week ' + idx + ' (' + formatMonthDay_(weekStart) + '-' + formatMonthDay_(end) + ')';
}

function shiftsTabNameFor_(weekStart) {
  const idx = weekIndexFor_(weekStart);
  if (!idx) return '';
  const end = weekEndFor_(weekStart);
  return 'Week ' + idx + ' Shifts (' + formatMonthDay_(weekStart) + '-' + formatMonthDay_(end) + ')';
}

function isoToDDMM_(iso) {
  const parts = iso.split('-');
  return parts[2] + '/' + parts[1];
}

function weekDaysFor_(weekStart) {
  const days = [];
  const end = weekEndFor_(weekStart);
  let d = weekStart;
  while (d <= end) {
    days.push(d);
    d = addDaysIso_(d, 1);
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

function allWeekStarts_() {
  const out = [];
  let d = SCHEDULE_START_ISO;
  while (d <= SCHEDULE_END_ISO) {
    out.push(d);
    if (weekEndFor_(d) >= SCHEDULE_END_ISO) break;
    d = addDaysIso_(d, 7);
  }
  return out;
}

function getLocksSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const weeks = allWeekStarts_();
  const headers = weeks.map(function (w) { return tabNameFor_(w) || w; });
  const expectedCols = weeks.length + 1;
  let sheet = ss.getSheetByName(LOCKS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(LOCKS_TAB);
    initLocksSheet_(sheet, headers);
    return sheet;
  }
  // Detect old vertical format (col A header === 'weekStart' and 1 column),
  // or any layout mismatch, and rebuild.
  const firstCell = sheet.getRange(1, 1).getValue();
  const lastCol = sheet.getLastColumn();
  if (
    lastCol !== expectedCols ||
    String(firstCell).toLowerCase() === 'weekstart' ||
    String(sheet.getRange(2, 1).getValue()).toLowerCase() !== 'lock'
  ) {
    sheet.clear();
    sheet.clearDataValidations();
    initLocksSheet_(sheet, headers);
  } else {
    // Ensure headers in row 1 match the schedule (in case the schedule changed).
    const existing = sheet.getRange(1, 2, 1, weeks.length).getValues()[0];
    let mismatch = false;
    for (let i = 0; i < headers.length; i += 1) {
      if (String(existing[i]) !== headers[i]) { mismatch = true; break; }
    }
    if (mismatch) {
      sheet.getRange(1, 2, 1, weeks.length).setValues([headers]);
    }
  }
  return sheet;
}

function initLocksSheet_(sheet, headers) {
  const weekCount = headers.length;
  sheet.getRange(1, 1).setValue('').setFontWeight('bold');
  sheet.getRange(1, 2, 1, weekCount).setValues([headers])
    .setFontWeight('bold').setBackground('#cfe2f3').setHorizontalAlignment('center');
  sheet.getRange(2, 1).setValue('lock').setFontWeight('bold').setBackground('#f3f3f3');
  const lockRow = sheet.getRange(2, 2, 1, weekCount);
  lockRow.setValues([headers.map(function () { return 'No'; })]);
  lockRow.setHorizontalAlignment('center');
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Yes', 'No'], true)
    .setAllowInvalid(false)
    .build();
  lockRow.setDataValidation(rule);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(1);
  sheet.autoResizeColumns(1, weekCount + 1);
}

function getLockedWeeks_() {
  const sheet = getLocksSheet_();
  const weeks = allWeekStarts_();
  if (weeks.length === 0) return {};
  const row = sheet.getRange(2, 2, 1, weeks.length).getValues()[0];
  const set = {};
  for (let i = 0; i < weeks.length; i += 1) {
    if (String(row[i]).trim().toLowerCase() === 'yes') set[weeks[i]] = true;
  }
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
    if (mode === 'weekSubmissions') {
      const week = (e && e.parameter && e.parameter.week) || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !weekIndexFor_(week)) {
        return jsonResponse_({ ok: false, reason: 'invalid' });
      }
      return jsonResponse_({ ok: true, submissions: readAllSubmissions_(week) });
    }
    if (mode === 'algo') {
      const week = (e && e.parameter && e.parameter.week) || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || !weekIndexFor_(week)) {
        return jsonResponse_({ ok: false, reason: 'invalid' });
      }
      return jsonResponse_({
        ok: true,
        weekStart: week,
        prevDay: readPrevDayForWeek_(week),
        current: readCurrentAssignmentsForWeek_(week),
        priorShifts: readPriorShiftsExcluding_(week),
      });
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
    if (body && body.mode === 'algo') {
      return handleAlgoSave_(body);
    }
    const phone = canonPhone_(body.phone || '');
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

      // Normalize and serialize reasons: only kept for cant slots on
      // days that are NOT marked unavailable. Empty/whitespace dropped.
      const reasonsIn = body.reasons || {};
      const reasonsOut = {};
      days.forEach(function (d) {
        if (unavailableSet[d]) return;
        const dayReasons = reasonsIn[d] || {};
        const dayShifts = shiftsIn[d] || {};
        const cleaned = {};
        SLOTS.forEach(function (slot) {
          if (dayShifts[slot] !== 'cant') return;
          const txt = String(dayReasons[slot] == null ? '' : dayReasons[slot]).trim();
          if (txt) cleaned[slot] = txt;
        });
        if (Object.keys(cleaned).length > 0) reasonsOut[d] = cleaned;
      });
      row.push(Object.keys(reasonsOut).length ? JSON.stringify(reasonsOut) : '');

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
    if (canonPhone_(r[1]) === canonPhone_(phone) && ts > latestTs) {
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
  col += 1;
  const reasonsStr = String(row[col] || '');
  const unavailableDays = atHomeStr
    ? atHomeStr.split(',').map(function (s) { return s.trim(); })
        .filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); })
    : [];
  let reasons = {};
  if (reasonsStr) {
    try {
      const parsed = JSON.parse(reasonsStr);
      if (parsed && typeof parsed === 'object') reasons = parsed;
    } catch (e) {
      reasons = {};
    }
  }

  return {
    phone: phone,
    name: String(row[2]),
    position: String(row[3]),
    weekStart: weekStart,
    unavailableDays: unavailableDays,
    shifts: shifts,
    reasons: reasons,
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
    const phone = (canonPhone_(display[i][1] || '')) ||
                  (canonPhone_(values[i][1] || ''));
    if (!phone) continue;
    const ts = String(values[i][0] || display[i][0] || '');
    const cur = latestByPhone[phone];
    if (!cur || ts > cur.ts) latestByPhone[phone] = { idx: i, ts: ts };
  }
  const keep = {};
  Object.keys(latestByPhone).forEach(function (p) { keep[latestByPhone[p].idx] = true; });
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const phone = (canonPhone_(display[i][1] || '')) ||
                  (canonPhone_(values[i][1] || ''));
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
  const target = canonPhone_(phone);
  const matches = [];
  for (let i = 0; i < display.length; i += 1) {
    const d = canonPhone_(display[i][0] || '');
    const r = canonPhone_(raw[i][0] || '');
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
  const target = canonPhone_(phone);
  for (let i = display.length - 1; i >= 0; i -= 1) {
    const d = canonPhone_(display[i][0] || '');
    const r = canonPhone_(raw[i][0] || '');
    if (target && (d === target || r === target)) {
      sheet.deleteRow(i + 2);
    }
  }
}

function snapshotRightAssignments_(sheet, weekStart) {
  // Read manual assignments from columns 6 (mefaked) and 7 (sambatz) of the
  // right-side table. Layout is deterministic: row 1 = title, row 2 = spacer,
  // then per day: day header / sub-headers / position labels / 3 slot rows /
  // spacer = 7 rows.
  const days = weekDaysFor_(weekStart);
  const snapshot = {};
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 6 || lastCol < 7) return snapshot;
  for (let k = 0; k < days.length; k += 1) {
    const dayStart = 3 + k * 7;
    snapshot[days[k]] = {};
    for (let s = 0; s < SLOTS.length; s += 1) {
      const row = dayStart + 3 + s;
      if (row > lastRow) break;
      const mefaked = String(sheet.getRange(row, 6).getValue() || '');
      const sambatz = String(sheet.getRange(row, 7).getValue() || '');
      snapshot[days[k]][SLOTS[s]] = { mefaked: mefaked, sambatz: sambatz };
    }
  }
  return snapshot;
}

function rebuildShiftsTab_(dataSheet, weekStart) {
  const tabName = shiftsTabNameFor_(weekStart);
  if (!tabName) return;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(tabName);
  const preserved = sheet ? snapshotRightAssignments_(sheet, weekStart) : {};
  if (!sheet) sheet = ss.insertSheet(tabName);
  sheet.clear();
  sheet.setHiddenGridlines(false);

  const days = weekDaysFor_(weekStart);
  const positions = ['mefaked_haml', 'sambatz'];

  // Build availability map: avail[day][slot][position] = [names...]
  const avail = {};
  // Unavailability per slot: unavail[day][slot][position] = [{name, reason}, ...]
  const unavail = {};
  days.forEach(function (d) {
    avail[d] = {};
    unavail[d] = {};
    SLOTS.forEach(function (s) {
      avail[d][s] = {};
      unavail[d][s] = {};
      positions.forEach(function (p) {
        avail[d][s][p] = [];
        unavail[d][s][p] = [];
      });
    });
  });

  const last = dataSheet.getLastRow();
  if (last >= 2) {
    const headers = buildHeaders_(weekStart);
    const totalCols = headers.length;
    const rows = dataSheet.getRange(2, 1, last - 1, totalCols).getValues();
    const display = dataSheet.getRange(2, 1, last - 1, totalCols).getDisplayValues();
    const FIXED = FIXED_HEADERS.length;
    const AT_HOME_COL = FIXED + days.length * SLOTS.length;     // 0-based
    const REASONS_COL = AT_HOME_COL + 1;

    // Keep only the latest row per phone (by submittedAt).
    const latestByPhone = {};
    rows.forEach(function (r, i) {
      const phoneDigits =
        canonPhone_(display[i][1] || '') ||
        canonPhone_(r[1] || '');
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

      // At-home (full-day unavailable) days → add בבית as reason for all slots.
      const atHomeStr = String(r[AT_HOME_COL] || '');
      const atHomeDays = atHomeStr
        ? atHomeStr.split(',').map(function (s) { return s.trim(); })
            .filter(function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); })
        : [];
      atHomeDays.forEach(function (d) {
        if (!unavail[d]) return;
        SLOTS.forEach(function (slot) {
          unavail[d][slot][position].push({ name: name, reason: 'בבית' });
        });
      });

      // Per-slot reasons from JSON column.
      const rawReasons = String(r[REASONS_COL] || '').trim();
      if (rawReasons) {
        let parsed = null;
        try { parsed = JSON.parse(rawReasons); } catch (e) { parsed = null; }
        if (parsed && typeof parsed === 'object') {
          days.forEach(function (d) {
            const dayObj = parsed[d];
            if (!dayObj || typeof dayObj !== 'object') return;
            SLOTS.forEach(function (slot) {
              const txt = String(dayObj[slot] == null ? '' : dayObj[slot]).trim();
              if (txt) unavail[d][slot][position].push({ name: name, reason: txt });
            });
          });
        }
      }
    });
  }

  // Write blocks per day, stacked vertically.
  sheet.setRightToLeft(true);

  const COL_TIME = 1;
  const COL_MEFAKED = 2;
  const COL_SAMBATZ = 3;
  const COL_SPACER = 4;
  const COL_TIME_R = 5;
  const COL_MEFAKED_R = 6;
  const COL_SAMBATZ_R = 7;
  const LEFT_COLS = 3;
  const RIGHT_COLS = 3;
  const TOTAL_COLS = 7;

  const COLOR_TITLE_BG = '#1f3a5f';
  const COLOR_TITLE_FG = '#ffffff';
  const COLOR_DAY_BG = '#2f5d8e';
  const COLOR_DAY_FG = '#ffffff';
  const COLOR_SUBHDR_AVAIL = '#cfe2f3';
  const COLOR_SUBHDR_ASSIGN = '#fce5cd';
  const COLOR_POS_BG = '#e8eef7';
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

    // Day header row — duplicated above each table
    const dayLabel = 'יום ' + dayName + ' · ' + isoToDDMM_(d);
    const dayHeaderLeft = sheet.getRange(curRow, COL_TIME, 1, LEFT_COLS);
    dayHeaderLeft.merge();
    dayHeaderLeft.setValue(dayLabel)
      .setBackground(COLOR_DAY_BG)
      .setFontColor(COLOR_DAY_FG)
      .setFontWeight('bold')
      .setFontSize(13)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    const dayHeaderRight = sheet.getRange(curRow, COL_TIME_R, 1, RIGHT_COLS);
    dayHeaderRight.merge();
    dayHeaderRight.setValue(dayLabel)
      .setBackground(COLOR_DAY_BG)
      .setFontColor(COLOR_DAY_FG)
      .setFontWeight('bold')
      .setFontSize(13)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(curRow, 30);
    curRow += 1;

    // Sub-headers: "זמינות" over left table, "שיבוץ" over right table
    const leftSub = sheet.getRange(curRow, COL_TIME, 1, LEFT_COLS);
    leftSub.merge();
    leftSub.setValue('זמינות')
      .setBackground(COLOR_SUBHDR_AVAIL)
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    const rightSub = sheet.getRange(curRow, COL_TIME_R, 1, RIGHT_COLS);
    rightSub.merge();
    rightSub.setValue('שיבוץ')
      .setBackground(COLOR_SUBHDR_ASSIGN)
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(curRow, 24);
    curRow += 1;

    // Position label row (both tables)
    const posRow = [['', POSITION_LABELS_HE.mefaked_haml, POSITION_LABELS_HE.sambatz, '',
                     '', POSITION_LABELS_HE.mefaked_haml, POSITION_LABELS_HE.sambatz]];
    const posRange = sheet.getRange(curRow, 1, 1, TOTAL_COLS);
    posRange.setValues(posRow);
    sheet.getRange(curRow, COL_TIME, 1, LEFT_COLS).setBackground(COLOR_POS_BG);
    sheet.getRange(curRow, COL_TIME_R, 1, RIGHT_COLS).setBackground(COLOR_POS_BG);
    posRange.setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(curRow, 26);
    curRow += 1;

    const slotStartRow = curRow;
    SLOTS.forEach(function (slot, slotIdx) {
      const mefakedNames = avail[d][slot].mefaked_haml;
      const sambatzNames = avail[d][slot].sambatz;
      const mefakedUnavail = unavail[d][slot].mefaked_haml;
      const sambatzUnavail = unavail[d][slot].sambatz;
      const prev = (preserved[d] && preserved[d][slot]) || { mefaked: '', sambatz: '' };

      // Plain text for non-availability cells; rich text for the two avail cells.
      const mefakedCell = buildAvailRichText_(mefakedNames, mefakedUnavail);
      const sambatzCell = buildAvailRichText_(sambatzNames, sambatzUnavail);

      sheet.getRange(curRow, COL_TIME).setValue(SHIFT_TIME_LABELS[slot]);
      sheet.getRange(curRow, COL_MEFAKED).setRichTextValue(mefakedCell);
      sheet.getRange(curRow, COL_SAMBATZ).setRichTextValue(sambatzCell);
      sheet.getRange(curRow, COL_SPACER).setValue('');
      sheet.getRange(curRow, COL_TIME_R).setValue(SHIFT_TIME_LABELS[slot]);
      sheet.getRange(curRow, COL_MEFAKED_R).setValue(prev.mefaked);
      sheet.getRange(curRow, COL_SAMBATZ_R).setValue(prev.sambatz);

      const rowRange = sheet.getRange(curRow, 1, 1, TOTAL_COLS);
      rowRange.setVerticalAlignment('middle')
        .setHorizontalAlignment('center')
        .setWrap(true)
        .setFontSize(11);

      const bandColor = slotIdx % 2 === 0 ? COLOR_BAND_A : COLOR_BAND_B;
      sheet.getRange(curRow, COL_MEFAKED, 1, 2).setBackground(bandColor);
      sheet.getRange(curRow, COL_MEFAKED_R, 1, 2).setBackground(bandColor);
      sheet.getRange(curRow, COL_TIME)
        .setBackground(COLOR_TIME_BG)
        .setFontWeight('bold')
        .setFontSize(11);
      sheet.getRange(curRow, COL_TIME_R)
        .setBackground(COLOR_TIME_BG)
        .setFontWeight('bold')
        .setFontSize(11);

      // Count lines per cell so the row height fits all of them.
      const mefakedLines = mefakedNames.length + (mefakedUnavail.length > 0
        ? mefakedUnavail.length + (mefakedNames.length > 0 ? 1 : 0)
        : 0);
      const sambatzLines = sambatzNames.length + (sambatzUnavail.length > 0
        ? sambatzUnavail.length + (sambatzNames.length > 0 ? 1 : 0)
        : 0);
      const maxNames = Math.max(
        1,
        mefakedLines,
        sambatzLines,
        (prev.mefaked.match(/\n/g) || []).length + (prev.mefaked ? 1 : 0),
        (prev.sambatz.match(/\n/g) || []).length + (prev.sambatz ? 1 : 0),
      );
      sheet.setRowHeight(curRow, Math.max(36, 18 + maxNames * 18));

      curRow += 1;
    });

    // Borders around the LEFT block (sub-header + position labels + slot rows = SLOTS.length + 2 rows).
    const leftBlock = sheet.getRange(curRow - SLOTS.length - 2, COL_TIME, SLOTS.length + 2, LEFT_COLS);
    leftBlock.setBorder(true, true, true, true, false, false, COLOR_BORDER,
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    const rightBlock = sheet.getRange(curRow - SLOTS.length - 2, COL_TIME_R, SLOTS.length + 2, RIGHT_COLS);
    rightBlock.setBorder(true, true, true, true, false, false, COLOR_BORDER,
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

    // Inner horizontal separators between slot rows (both tables).
    sheet.getRange(slotStartRow, COL_TIME, SLOTS.length, LEFT_COLS)
      .setBorder(null, null, null, null, false, true, '#dadce0',
        SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(slotStartRow, COL_TIME_R, SLOTS.length, RIGHT_COLS)
      .setBorder(null, null, null, null, false, true, '#dadce0',
        SpreadsheetApp.BorderStyle.SOLID);
    // Vertical separator between position columns.
    sheet.getRange(slotStartRow - 1, COL_MEFAKED, SLOTS.length + 1, 2)
      .setBorder(null, null, null, null, true, false, '#dadce0',
        SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(slotStartRow - 1, COL_MEFAKED_R, SLOTS.length + 1, 2)
      .setBorder(null, null, null, null, true, false, '#dadce0',
        SpreadsheetApp.BorderStyle.SOLID);

    sheet.setRowHeight(curRow, 10); // spacer between days
    curRow += 1;
  });

  sheet.setColumnWidth(COL_TIME, 110);
  sheet.setColumnWidth(COL_MEFAKED, 220);
  sheet.setColumnWidth(COL_SAMBATZ, 280);
  sheet.setColumnWidth(COL_SPACER, 20);
  sheet.setColumnWidth(COL_TIME_R, 110);
  sheet.setColumnWidth(COL_MEFAKED_R, 160);
  sheet.setColumnWidth(COL_SAMBATZ_R, 200);
  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
}

/**
 * Builds a RichTextValue for an availability cell:
 *   • Available names (one per line, default styling)
 *   • A grey separator line ("———") if both groups are non-empty
 *   • Unavailable entries: "✕ name — reason", styled red + italic
 */
function buildAvailRichText_(availNames, unavailEntries) {
  const lines = [];
  availNames.forEach(function (n) { lines.push({ text: n, kind: 'avail' }); });
  if (unavailEntries && unavailEntries.length > 0) {
    if (availNames.length > 0) lines.push({ text: '———', kind: 'sep' });
    unavailEntries.forEach(function (e) {
      const reason = e.reason ? ' — ' + e.reason : '';
      lines.push({ text: '✕ ' + e.name + reason, kind: 'unavail' });
    });
  }
  if (lines.length === 0) {
    return SpreadsheetApp.newRichTextValue().setText('').build();
  }
  const full = lines.map(function (l) { return l.text; }).join('\n');
  const builder = SpreadsheetApp.newRichTextValue().setText(full);
  const unavailStyle = SpreadsheetApp.newTextStyle()
    .setForegroundColor('#c5221f')
    .setItalic(true)
    .build();
  const sepStyle = SpreadsheetApp.newTextStyle()
    .setForegroundColor('#9aa0a6')
    .build();
  let pos = 0;
  lines.forEach(function (l) {
    const start = pos;
    const end = pos + l.text.length;
    if (l.kind === 'unavail') builder.setTextStyle(start, end, unavailStyle);
    else if (l.kind === 'sep') builder.setTextStyle(start, end, sepStyle);
    pos = end + 1; // +1 for the joining newline
  });
  return builder.build();
}

// =====================================================================
// /algo endpoints
// =====================================================================

function readAllSubmissions_(weekStart) {
  const sheet = getWeekSheet_(weekStart);
  if (!sheet) return [];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const headers = buildHeaders_(weekStart);
  const totalCols = headers.length;
  const values = sheet.getRange(2, 1, last - 1, totalCols).getValues();
  const display = sheet.getRange(2, 1, last - 1, totalCols).getDisplayValues();
  const days = weekDaysFor_(weekStart);
  const FIXED = FIXED_HEADERS.length;

  const latestByPhone = {};
  values.forEach(function (r, i) {
    const phoneDigits = canonPhone_(display[i][1] || '') || canonPhone_(r[1] || '');
    if (!phoneDigits) return;
    const ts = String(r[0] || display[i][0] || '');
    const cur = latestByPhone[phoneDigits];
    if (!cur || ts > cur.ts) latestByPhone[phoneDigits] = { row: r, ts: ts };
  });

  const out = [];
  Object.keys(latestByPhone).forEach(function (phone) {
    const r = latestByPhone[phone].row;
    const position = String(r[3] || '').trim();
    if (position !== 'mefaked_haml' && position !== 'sambatz') return;
    const shifts = {};
    days.forEach(function (d, dayIdx) {
      const cells = {};
      SLOTS.forEach(function (slot, slotIdx) {
        const v = String(r[FIXED + dayIdx * SLOTS.length + slotIdx]).trim();
        cells[slot] = (v === '1' || v === 'can') ? 'can' : 'cant';
      });
      shifts[d] = cells;
    });
    out.push({
      phone: phone,
      name: String(r[2] || '').trim(),
      position: position,
      weekStart: weekStart,
      unavailableDays: [],
      shifts: shifts,
      submittedAt: latestByPhone[phone].ts,
    });
  });
  return out;
}

function parseNames_(cellValue) {
  return String(cellValue || '')
    .split(/\r?\n|,/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

function readShiftsTabAssignments_(weekStart) {
  // Returns { [date]: { morning|afternoon|night: { mefaked_haml:[], sambatz:[] } } }
  // from the right-side שיבוץ block of the Week N Shifts tab.
  const tabName = shiftsTabNameFor_(weekStart);
  if (!tabName) return null;
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return null;
  const days = weekDaysFor_(weekStart);
  const out = {};
  for (let k = 0; k < days.length; k += 1) {
    const dayStart = 3 + k * 7;
    out[days[k]] = {};
    for (let s = 0; s < SLOTS.length; s += 1) {
      const row = dayStart + 3 + s;
      const mefaked = parseNames_(sheet.getRange(row, 6).getValue());
      const sambatz = parseNames_(sheet.getRange(row, 7).getValue());
      out[days[k]][SLOTS[s]] = { mefaked_haml: mefaked, sambatz: sambatz };
    }
  }
  return out;
}

function readCurrentAssignmentsForWeek_(weekStart) {
  const data = readShiftsTabAssignments_(weekStart);
  if (!data) return null;
  // If everything is empty, return null so the UI doesn't show "loaded" needlessly.
  const days = Object.keys(data);
  let any = false;
  for (const d of days) {
    for (const s of SLOTS) {
      if (data[d][s].mefaked_haml.length || data[d][s].sambatz.length) {
        any = true; break;
      }
    }
    if (any) break;
  }
  return any ? data : null;
}

function prevWeekStart_(weekStart) {
  const candidate = addDaysIso_(weekStart, -7);
  if (candidate < SCHEDULE_START_ISO) return '';
  if (!weekIndexFor_(candidate)) return '';
  return candidate;
}

function readPrevDayForWeek_(weekStart) {
  // Previous Wednesday = day before weekStart. If a previous week exists in our
  // schedule, that Wednesday is the LAST day of that week, and its assignments
  // are stored in the previous week's Shifts tab. Return null when there is
  // no previous week.
  const prev = prevWeekStart_(weekStart);
  if (!prev) return null;
  const data = readShiftsTabAssignments_(prev);
  if (!data) return null;
  const prevWedDate = addDaysIso_(weekStart, -1);
  const day = data[prevWedDate];
  if (!day) return null;
  const morning = day.morning || { mefaked_haml: [], sambatz: [] };
  const afternoon = day.afternoon || { mefaked_haml: [], sambatz: [] };
  const night = day.night || { mefaked_haml: [], sambatz: [] };
  if (
    morning.mefaked_haml.length === 0 && morning.sambatz.length === 0 &&
    afternoon.mefaked_haml.length === 0 && afternoon.sambatz.length === 0 &&
    night.mefaked_haml.length === 0 && night.sambatz.length === 0
  ) {
    return null;
  }
  return { morning: morning, afternoon: afternoon, night: night };
}

function handleAlgoSave_(body) {
  const weekStart = String(body.weekStart || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !weekIndexFor_(weekStart)) {
    return jsonResponse_({ ok: false, reason: 'invalid' });
  }
  if (isWeekLocked_(weekStart)) {
    return jsonResponse_({ ok: false, reason: 'locked' });
  }
  const assignments = body.assignments || {};

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Make sure the shifts tab exists with the current availability layout.
    const dataSheet = getWeekSheet_(weekStart);
    if (dataSheet) rebuildShiftsTab_(dataSheet, weekStart);

    const tabName = shiftsTabNameFor_(weekStart);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) return jsonResponse_({ ok: false, reason: 'server_error' });

    const days = weekDaysFor_(weekStart);
    for (let k = 0; k < days.length; k += 1) {
      const dayStart = 3 + k * 7;
      const dayAssign = assignments[days[k]] || {};
      for (let s = 0; s < SLOTS.length; s += 1) {
        const slot = SLOTS[s];
        const slotAssign = dayAssign[slot] || { mefaked_haml: [], sambatz: [] };
        const row = dayStart + 3 + s;
        const mefakedStr = (slotAssign.mefaked_haml || []).join('\n');
        const sambatzStr = (slotAssign.sambatz || []).join('\n');
        sheet.getRange(row, 6).setValue(mefakedStr);
        sheet.getRange(row, 7).setValue(sambatzStr);
        const maxNames = Math.max(
          1,
          (slotAssign.mefaked_haml || []).length,
          (slotAssign.sambatz || []).length,
        );
        const existingHeight = sheet.getRowHeight(row);
        const desired = Math.max(36, 18 + maxNames * 18);
        if (desired > existingHeight) sheet.setRowHeight(row, desired);
      }
    }
    // Update the cross-week ledger so balance applies next week.
    try { updateOverallShifts_(weekStart, assignments); } catch (e) { /* non-fatal */ }
    return jsonResponse_({ ok: true });
  } catch (err) {
    return jsonResponse_({ ok: false, reason: 'server_error', error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// Admin overrides — sync manual edits to raw "Week N (...)" tabs back
// into the rendered "Week N Shifts (...)" tab and the rest of the
// platform.
//
// Setup (run ONCE from the Apps Script editor):
//   1. Open the script editor.
//   2. Select the function `setupOnEditTrigger` and click Run. Authorize.
//   3. The trigger is installable (not the simple onEdit), which lets it
//      acquire a ScriptLock while rebuilding.
//
// Behavior:
//   - Edits in row 1 (headers) are ignored.
//   - For each edited data row, `submittedAt` (col 1) is bumped to now so
//     the manual edit beats any earlier soldier submission in the dedupe.
//   - The full raw tab is re-deduped by phone (keeping latest submittedAt)
//     and the matching "Week N Shifts" tab is rebuilt. The right-side
//     שיבוץ block is preserved (hard constraints survive).
//   - Edits in "Week N Shifts" tabs are ignored — the right-side block is
//     preserved automatically on the next rebuild; the left-side block is
//     regenerated from the raw tab and shouldn't be hand-edited.
// =====================================================================

function setupOnEditTrigger() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'onEditAdminSync') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('onEditAdminSync')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  SpreadsheetApp.getActive().toast(
    'Admin-edit sync trigger installed.',
    'Soldier Scheduler',
    5,
  );
}

function weekStartForRawTab_(tabName) {
  // Returns the weekStart whose raw data tab matches the given name, or '' if
  // the name corresponds to a non-raw tab (e.g. the "Shifts" rendered tab).
  if (!tabName || tabName.indexOf(' Shifts ') !== -1) return '';
  const weeks = allWeekStarts_();
  for (let i = 0; i < weeks.length; i += 1) {
    if (tabNameFor_(weeks[i]) === tabName) return weeks[i];
  }
  return '';
}

function onEditAdminSync(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    const tabName = sheet.getName();
    const weekStart = weekStartForRawTab_(tabName);
    if (!weekStart) return; // not a raw Week N tab

    const startRow = e.range.getRow();
    const numRows = e.range.getNumRows();
    const endRow = startRow + numRows - 1;
    if (endRow < 2) return; // header-only edit

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) return; // a soldier POST is in flight; skip
    try {
      // 1. Bump submittedAt to "now" for each touched data row that has any
      //    content. This guarantees admin edits beat earlier soldier rows
      //    during dedupe-by-phone.
      const now = new Date().toISOString();
      const totalCols = Math.max(1, sheet.getLastColumn());
      const firstDataRow = Math.max(2, startRow);
      const rowsToCheck = endRow - firstDataRow + 1;
      if (rowsToCheck > 0) {
        const range = sheet.getRange(firstDataRow, 1, rowsToCheck, totalCols);
        const values = range.getValues();
        const submitCol = sheet.getRange(firstDataRow, 1, rowsToCheck, 1);
        const newSubmits = submitCol.getValues();
        let changed = false;
        for (let i = 0; i < values.length; i += 1) {
          let hasAny = false;
          for (let j = 1; j < values[i].length; j += 1) {
            const v = values[i][j];
            if (v !== '' && v != null) { hasAny = true; break; }
          }
          if (hasAny) {
            newSubmits[i][0] = now;
            changed = true;
          }
        }
        if (changed) submitCol.setValues(newSubmits);
      }

      // 2. Dedupe and rebuild.
      dedupeAllPhones_(sheet);
      rebuildShiftsTab_(sheet, weekStart);

      SpreadsheetApp.getActive().toast(
        'Synced edits → ' + shiftsTabNameFor_(weekStart),
        'Soldier Scheduler',
        3,
      );
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Never throw from a trigger — it would leave the lock acquired.
    try {
      SpreadsheetApp.getActive().toast(
        'Sync failed: ' + String(err),
        'Soldier Scheduler',
        5,
      );
    } catch (e2) { /* ignore */ }
  }
}

// =====================================================================
// Overall Shifts ledger
//
// A single tab named "Overall Shifts" with one row per soldier (keyed
// by phone). Columns: phone | name | position | total | <weekStart ISO>...
//
// • `handleAlgoSave_` calls `updateOverallShifts_` after writing the
//   shifts tab. The value in the column for that week is REPLACED with
//   the per-phone count for the just-saved schedule (so re-saving the
//   same week is idempotent), and `total` is recomputed as the row sum.
// • `handleAlgoLoad_` includes `priorShifts`: for each phone, the sum
//   of all other week columns (i.e., total minus this week's contrib).
//   The scheduler biases selection toward soldiers with lower
//   priorShifts so workload evens out across weeks.
// • N/A placeholders are ignored — they never count toward any phone.
// =====================================================================

function getOrCreateOverallSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(OVERALL_TAB);
  if (!sh) {
    sh = ss.insertSheet(OVERALL_TAB);
    sh.getRange(1, 1, 1, OVERALL_FIXED_HEADERS.length).setValues([OVERALL_FIXED_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, OVERALL_FIXED_HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

function readOverallHeaders_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), OVERALL_FIXED_HEADERS.length);
  const row = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  // Ensure the fixed headers exist in the expected order; if the sheet
  // was hand-edited and headers are missing, repair them.
  for (let i = 0; i < OVERALL_FIXED_HEADERS.length; i += 1) {
    if (row[i] !== OVERALL_FIXED_HEADERS[i]) {
      sh.getRange(1, i + 1).setValue(OVERALL_FIXED_HEADERS[i]);
      row[i] = OVERALL_FIXED_HEADERS[i];
    }
  }
  return row;
}

function findOrAppendWeekColumn_(sh, headers, weekStart) {
  for (let i = OVERALL_FIXED_HEADERS.length; i < headers.length; i += 1) {
    if (String(headers[i]) === weekStart) return i + 1; // 1-based column
  }
  const col = headers.length + 1;
  sh.getRange(1, col).setValue(weekStart).setFontWeight('bold');
  headers.push(weekStart);
  return col;
}

function readOverallRows_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), OVERALL_FIXED_HEADERS.length);
  if (lastRow < 2) return { rows: [], byPhone: {} };
  const values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const byPhone = {};
  const rows = [];
  for (let i = 0; i < values.length; i += 1) {
    const phone = canonPhone_(values[i][0]);
    if (!phone) continue;
    const rec = { rowIndex: i + 2, values: values[i].slice() };
    rec.values[0] = phone;
    rows.push(rec);
    byPhone[phone] = rec;
  }
  return { rows: rows, byPhone: byPhone };
}

function countAssignmentsPerPhone_(assignments, weekStart) {
  // Resolves names in saved assignments back to phones via the week's
  // submissions; falls back to the literal name string for admin-added
  // entries that don't correspond to a submitter.
  const counts = {};
  const nameByPhone = {};
  const positionByPhone = {};
  const dataSheet = getWeekSheet_(weekStart);
  if (dataSheet) {
    const subs = readAllSubmissions_(weekStart);
    subs.forEach(function (s) {
      const p = canonPhone_(s.phone);
      if (!p) return;
      nameByPhone[s.name] = p;
      positionByPhone[p] = s.position;
      if (!(p in counts)) counts[p] = 0;
    });
  }
  Object.keys(assignments || {}).forEach(function (d) {
    SLOTS.forEach(function (slot) {
      const block = (assignments[d] || {})[slot] || { mefaked_haml: [], sambatz: [] };
      ['mefaked_haml', 'sambatz'].forEach(function (role) {
        (block[role] || []).forEach(function (name) {
          if (!name || isNaSentinel_(name)) return;
          const key = String(name).trim();
          if (!key) return;
          const phone = nameByPhone[key] || key;
          counts[phone] = (counts[phone] || 0) + 1;
          if (!positionByPhone[phone]) positionByPhone[phone] = role;
        });
      });
    });
  });
  // Build a phone->name map for display in the overall tab. For unknown
  // phones (admin-added) we just keep the literal name string.
  const displayName = {};
  Object.keys(nameByPhone).forEach(function (n) { displayName[nameByPhone[n]] = n; });
  Object.keys(counts).forEach(function (p) { if (!displayName[p]) displayName[p] = p; });
  return { counts: counts, displayName: displayName, position: positionByPhone };
}

function isNaSentinel_(v) {
  return String(v).trim() === '— N/A —';
}

function updateOverallShifts_(weekStart, assignments) {
  const sh = getOrCreateOverallSheet_();
  const headers = readOverallHeaders_(sh);
  const weekCol = findOrAppendWeekColumn_(sh, headers, weekStart);
  // Re-read headers in case the row was extended by the helper above.
  const finalLastCol = Math.max(sh.getLastColumn(), headers.length);
  const { rows, byPhone } = readOverallRows_(sh);
  const breakdown = countAssignmentsPerPhone_(assignments, weekStart);
  const counts = breakdown.counts;

  // 1) Zero this week's column for any phone NOT in the new counts —
  //    they may have been removed from the schedule on re-save.
  rows.forEach(function (rec) {
    const phone = rec.values[0];
    const had = Number(rec.values[weekCol - 1] || 0);
    const now = counts[phone] || 0;
    if (had !== now) {
      sh.getRange(rec.rowIndex, weekCol).setValue(now);
      rec.values[weekCol - 1] = now;
    }
  });

  // 2) Add rows for phones we haven't seen before.
  Object.keys(counts).forEach(function (phone) {
    if (byPhone[phone]) return;
    const newRow = sh.getLastRow() + 1;
    const blank = new Array(finalLastCol).fill('');
    blank[0] = phone;
    blank[1] = breakdown.displayName[phone] || '';
    blank[2] = breakdown.position[phone] || '';
    blank[3] = 0;
    blank[weekCol - 1] = counts[phone];
    sh.getRange(newRow, 1, 1, finalLastCol).setValues([blank]);
    byPhone[phone] = { rowIndex: newRow, values: blank.slice() };
  });

  // 3) Recompute the `total` column for every row.
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;
  const lastCol = sh.getLastColumn();
  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const totals = data.map(function (r) {
    let sum = 0;
    for (let i = OVERALL_FIXED_HEADERS.length; i < lastCol; i += 1) {
      const n = Number(r[i]);
      if (!isNaN(n)) sum += n;
    }
    return [sum];
  });
  sh.getRange(2, 4, totals.length, 1).setValues(totals);
}

function readPriorShiftsExcluding_(weekStart) {
  // Returns { phone: priorTotal } where priorTotal = total - this week's
  // column (so a re-run of /algo doesn't double-count whatever is
  // already saved for this week).
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(OVERALL_TAB);
  if (!sh || sh.getLastRow() < 2) return {};
  const lastCol = Math.max(sh.getLastColumn(), OVERALL_FIXED_HEADERS.length);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let weekColIdx = -1;
  for (let i = OVERALL_FIXED_HEADERS.length; i < headers.length; i += 1) {
    if (String(headers[i]) === weekStart) { weekColIdx = i; break; }
  }
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, lastCol).getValues();
  const out = {};
  values.forEach(function (r) {
    const phone = canonPhone_(r[0]);
    if (!phone) return;
    const total = Number(r[3] || 0);
    const here = weekColIdx >= 0 ? Number(r[weekColIdx] || 0) : 0;
    out[phone] = Math.max(0, total - here);
  });
  return out;
}
