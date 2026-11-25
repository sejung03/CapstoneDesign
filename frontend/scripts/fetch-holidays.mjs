// 공휴일 목록 만들기(개발자가 직접 실행). 앱은 실행 중 이 API를 부르지 않고, 만든 holiday-data.mjs만 읽는다.
// 출처: 공공데이터포털 「한국천문연구원_특일 정보」 getRestDeInfo(공휴일·대체공휴일·임시공휴일·선거일, isHoliday=Y)
// 실행: node --env-file=.env.local scripts/fetch-holidays.mjs 2026 2027
// 키: HOLIDAY_DATA_KEY → PUBLIC_DATA_SERVICE_KEY → PUBLIC_DATA_HOSPITAL_KEY 순서로 읽는다(특일 정보 활용 신청이 된 공공데이터포털 키).
// 키는 출력하지 않는다. 한 해라도 실패하면 파일을 쓰지 않는다.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ENDPOINT='https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';
const OUTPUT=new URL('../holiday-data.mjs',import.meta.url);
// 법정 공휴일만 세어도 한 해 13일 이상이다(겹치는 해 포함). 이보다 적으면 응답이 잘린 것으로 본다.
const MIN_PER_YEAR=13;

function serviceKey(env){
 let key=String(env.HOLIDAY_DATA_KEY||env.PUBLIC_DATA_SERVICE_KEY||env.PUBLIC_DATA_HOSPITAL_KEY||'').trim();
 if(/%[0-9a-f]{2}/i.test(key)){try{key=decodeURIComponent(key);}catch{}}
 return key;
}

export function parseHolidayResponse(text,{year,month}){
 if(typeof text!=='string'||text.length>500000)throw Error('holidayInvalidResponse');
 // 인증 오류 등은 _type=json이어도 XML로 온다
 if(/^\s*</.test(text)){
  const code=text.match(/<(?:returnReasonCode|resultCode)>\s*([^<]+)</i)?.[1]?.trim();
  throw Error(['20','30','31','32'].includes(code)?'holidayAuthFailed':code==='22'?'holidayQuotaExceeded':'holidayUpstreamFailed:'+(code||'xml'));
 }
 const data=JSON.parse(text),header=data?.response?.header,body=data?.response?.body;
 if(!['0','00','0000'].includes(String(header?.resultCode)))throw Error('holidayUpstreamFailed:'+header?.resultCode);
 const raw=body?.items?.item;
 const list=raw===undefined||raw===''||body?.items===''?[]:Array.isArray(raw)?raw:[raw];
 const out=[];
 for(const item of list){
  if(item?.isHoliday!=='Y')continue;
  const digits=String(item.locdate);
  if(!/^\d{8}$/.test(digits)||Number(digits.slice(0,4))!==year||Number(digits.slice(4,6))!==month)throw Error('holidayInvalidDate');
  const name=String(item.dateName||'').trim().slice(0,40);
  if(!name)throw Error('holidayInvalidName');
  out.push([digits.slice(0,4)+'-'+digits.slice(4,6)+'-'+digits.slice(6,8),name]);
 }
 return out;
}

async function fetchMonth(key,year,month,fetcher){
 const url=new URL(ENDPOINT);
 url.searchParams.set('serviceKey',key);url.searchParams.set('solYear',String(year));url.searchParams.set('solMonth',String(month).padStart(2,'0'));
 url.searchParams.set('_type','json');url.searchParams.set('numOfRows','50');
 const response=await fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw Error(response.status===401||response.status===403?'holidayAuthFailed':'holidayUpstreamFailed:'+response.status);
 return parseHolidayResponse(await response.text(),{year,month});
}

export async function fetchHolidays(years,{env=process.env,fetcher=globalThis.fetch}={}){
 const key=serviceKey(env);
 if(!key)throw Error('holidayKeyMissing');
 const dates={};
 for(const year of years){
  let count=0;
  for(let month=1;month<=12;month++){
   for(const [date,name] of await fetchMonth(key,year,month,fetcher)){
    // 같은 날 둘(예: 추석과 개천절)이면 이름을 이어 붙인다
    dates[date]=dates[date]&&!dates[date].includes(name)?dates[date]+'·'+name:name;count++;
   }
  }
  if(count<MIN_PER_YEAR)throw Error(`holidayTooFew:${year}:${count}`);
 }
 return Object.fromEntries(Object.entries(dates).sort(([a],[b])=>a.localeCompare(b)));
}

export function renderHolidayModule({years,dates,fetchedAt}){
 return `// 자동 생성 파일: node --env-file=.env.local scripts/fetch-holidays.mjs ${years.join(' ')}
// 출처: 공공데이터포털 「한국천문연구원_특일 정보」 getRestDeInfo (isHoliday=Y). 직접 고치지 말고 스크립트를 다시 실행한다.
// years에 없는 해는 공휴일 여부를 "모름"으로 본다(holidays.mjs).
export const holidayData=${JSON.stringify({source:'KASI SpcdeInfoService getRestDeInfo',fetchedAt,years,dates},null,1)};
`;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 const years=process.argv.slice(2).map(Number);
 if(!years.length||years.some(y=>!Number.isInteger(y)||y<2000||y>2100)){console.error('사용법: node --env-file=.env.local scripts/fetch-holidays.mjs 2026 2027');process.exit(2);}
 try{
  const dates=await fetchHolidays(years);
  await writeFile(OUTPUT,renderHolidayModule({years,dates,fetchedAt:new Date().toISOString().slice(0,10)}));
  console.log(`holiday-data.mjs: ${years.join(', ')}년 공휴일 ${Object.keys(dates).length}일`);
  for(const [date,name] of Object.entries(dates))console.log(' ',date,name);
 }catch(error){console.error('공휴일 목록을 만들지 못했습니다:',String(error.message).replace(/serviceKey=[^&\s]+/g,'serviceKey=***'));process.exit(1);}
}
