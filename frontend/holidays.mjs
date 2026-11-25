// 공휴일 판정(서울 날짜 기준). 날짜 목록은 holiday-data.mjs(특일 정보 API로 생성)만 쓴다.
// 목록에 없는 해는 "모름"(null)으로 돌려준다: 공휴일이 아니라고 조용히 가정하지 않고, 화면이 안내할 수 있게 한다.
import {holidayData} from './holiday-data.mjs';

const seoulDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const DAY_MS=86400000;

/** 'YYYY-MM-DD' in Seoul. offsetDays moves by whole days (Korea has no daylight saving time). */
export function seoulDateKey(date=new Date(),offsetDays=0){return seoulDay.format(new Date(date.getTime()+offsetDays*DAY_MS));}

/** true / false, or null when that year is not in the holiday list. */
export function isPublicHoliday(date=new Date(),offsetDays=0){
 const key=seoulDateKey(date,offsetDays);
 if(!holidayData.years.includes(Number(key.slice(0,4))))return null;
 return Object.hasOwn(holidayData.dates,key);
}

/** The holiday name for that Seoul date, or ''. */
export function publicHolidayName(date=new Date()){return holidayData.dates[seoulDateKey(date)]||'';}
