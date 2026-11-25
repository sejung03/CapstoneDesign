import test from 'node:test';
import assert from 'node:assert/strict';
import {isPublicHoliday, publicHolidayName, seoulDateKey} from '../holidays.mjs';
import {holidayData} from '../holiday-data.mjs';
import {evaluateSchedule, readSchedule} from '../public-hours.mjs';
import {parseHolidayResponse, fetchHolidays} from '../scripts/fetch-holidays.mjs';

// Seoul is UTC+9. 2026-12-25 (Fri) is a public holiday; 2026-12-24 (Thu) and 2026-12-26 (Sat) are not.
const kst = (date, time) => new Date(`${date}T${time}:00+09:00`);

test('holiday is decided by the Seoul calendar date, and unknown years are null', () => {
  assert.equal(isPublicHoliday(kst('2026-12-25', '00:30')), true);
  assert.equal(isPublicHoliday(kst('2026-12-24', '23:30')), false);
  assert.equal(isPublicHoliday(kst('2026-12-26', '01:00'), -1), true);
  assert.equal(seoulDateKey(new Date('2026-12-24T15:30:00Z')), '2026-12-25');
  assert.equal(publicHolidayName(kst('2026-12-25', '12:00')), '기독탄신일');
  assert.equal(isPublicHoliday(kst('2030-01-01', '12:00')), null);
});

test('holiday data covers this year and next year (refresh with scripts/fetch-holidays.mjs)', () => {
  const year = Number(seoulDateKey(new Date()).slice(0, 4));
  assert.ok(holidayData.years.includes(year), `holiday-data.mjs has no ${year}`);
  for (const [date, name] of Object.entries(holidayData.dates)) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(holidayData.years.includes(Number(date.slice(0, 4))) && name.trim());
  }
  for (const y of holidayData.years) assert.ok(Object.keys(holidayData.dates).filter(d => d.startsWith(y + '-')).length >= 13);
});

const clinic = readSchedule({dutyTime5s: '0900', dutyTime5c: '1800'}); // Friday only, no holiday hours
const pharmacy = readSchedule({dutyTime4s: '2000', dutyTime4c: '0200', dutyTime5s: '0900', dutyTime5c: '1800', dutyTime8s: '1000', dutyTime8c: '0200'});

test('on a holiday, weekday hours are not used: no holiday hours means check before visiting', () => {
  assert.equal(evaluateSchedule(clinic, kst('2026-12-25', '10:00')).status, 'unknown');
  assert.equal(evaluateSchedule(clinic, kst('2026-12-25', '10:00'), {holiday: false}).status, 'open'); // the old behavior
  assert.equal(evaluateSchedule(pharmacy, kst('2026-12-25', '11:00')).status, 'open');
  assert.equal(evaluateSchedule(pharmacy, kst('2026-12-25', '11:00')).hours, '10:00–(+1) 02:00');
});

test('overnight hours carry over using whether yesterday was a holiday', () => {
  // Holiday 01:00: the Thursday 20:00–02:00 shift from the night before still counts.
  assert.equal(evaluateSchedule(pharmacy, kst('2026-12-25', '01:00')).status, 'open');
  // Day after the holiday 01:00: the holiday shift (10:00–02:00) carries over, not Friday's 09:00–18:00.
  assert.equal(evaluateSchedule(pharmacy, kst('2026-12-26', '01:00')).status, 'open');
  assert.equal(evaluateSchedule(pharmacy, kst('2026-12-26', '03:00')).status, 'unknown'); // Saturday has no hours
});

test('ordinary days keep their weekday result', () => {
  assert.equal(evaluateSchedule(clinic, kst('2026-12-18', '10:00')).status, 'open');
  assert.equal(evaluateSchedule(clinic, kst('2026-12-18', '19:00')).status, 'closed');
});

test('holiday API responses: arrays, single items, empty months and errors', () => {
  const json = item => JSON.stringify({response: {header: {resultCode: '00'}, body: {items: item === undefined ? '' : {item}}}});
  assert.deepEqual(parseHolidayResponse(json([
    {locdate: 20261225, dateName: '기독탄신일', isHoliday: 'Y'}, {locdate: 20261224, dateName: '기념일', isHoliday: 'N'},
  ]), {year: 2026, month: 12}), [['2026-12-25', '기독탄신일']]);
  assert.deepEqual(parseHolidayResponse(json({locdate: 20260101, dateName: '1월1일', isHoliday: 'Y'}), {year: 2026, month: 1}), [['2026-01-01', '1월1일']]);
  assert.deepEqual(parseHolidayResponse(json(undefined), {year: 2026, month: 4}), []);
  assert.throws(() => parseHolidayResponse(json({locdate: 20261125, dateName: 'x', isHoliday: 'Y'}), {year: 2026, month: 12}), /holidayInvalidDate/);
  assert.throws(() => parseHolidayResponse('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>', {year: 2026, month: 1}), /holidayAuthFailed/);
});

test('the generator refuses to write a short or keyless list', async () => {
  await assert.rejects(fetchHolidays([2026], {env: {}}), /holidayKeyMissing/);
  const oneADay = async url => {
    const month = new URL(url).searchParams.get('solMonth');
    return new Response(JSON.stringify({response: {header: {resultCode: '00'}, body: {items: {item: {locdate: Number('2026' + month + '01'), dateName: '가상 공휴일', isHoliday: 'Y'}}}}}));
  };
  await assert.rejects(fetchHolidays([2026], {env: {HOLIDAY_DATA_KEY: 'test'}, fetcher: oneADay}), /holidayTooFew:2026:12/);
});
