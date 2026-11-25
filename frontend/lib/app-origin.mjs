// 앱 주소(요청 출처 검사, 카카오 로그인 콜백)를 환경변수에서 읽는다. 어떤 값이 들어와도 예외를 던지지 않는다.
// 2026-11-25: Vercel의 APP_URL이 주소 형식이 아니어서(new URL 실패) 문진·음성·가입 API가 빈 500으로 멈춘 일이 있었다.
// - APP_URL: 따옴표·앞뒤 공백을 지우고, https:// 가 없으면 붙인다. 그래도 안 되면 무시한다.
// - Vercel이 자동으로 주는 이 배포의 주소(VERCEL_URL, VERCEL_BRANCH_URL, VERCEL_PROJECT_PRODUCTION_URL)도 우리 주소로 인정한다.
//   배포마다 바뀌는 미리보기 주소로 들어와도 API가 거절하지 않게 하기 위해서다. 다른 사이트의 주소는 여전히 거절한다.
const LOCAL_DEFAULT = 'http://127.0.0.1:3080';
const VERCEL_KEYS = ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL', 'VERCEL_URL'];

/** 주소 문자열 → origin('https://host[:port]'). 쓸 수 없으면 null. */
export function parseOrigin(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!text || /\s|,/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.origin : null;
  } catch {
    return null;
  }
}

/** 대표 주소: 카카오 로그인 콜백처럼 하나만 필요할 때. APP_URL → Vercel 운영 주소 → 이 배포 주소 → 로컬 기본값 순서. */
export function appOriginFrom(env = process.env) {
  return parseOrigin(env.APP_URL) || VERCEL_KEYS.map(key => parseOrigin(env[key])).find(Boolean) || LOCAL_DEFAULT;
}

/** 요청 출처로 인정하는 주소 목록 */
export function allowedOriginsFrom(env = process.env) {
  const list = [parseOrigin(env.APP_URL), ...VERCEL_KEYS.map(key => parseOrigin(env[key]))].filter(Boolean);
  return list.length ? [...new Set(list)] : [LOCAL_DEFAULT];
}

/** 같은 사이트에서 온 요청인가(브라우저가 붙이는 Origin과 Sec-Fetch-Site로 판단) */
export function isSameOrigin(request, env = process.env) {
  const origin = request.headers.get('origin');
  return !!origin && allowedOriginsFrom(env).includes(origin) && request.headers.get('sec-fetch-site') !== 'cross-site';
}

/** APP_URL이 들어 있지만 주소로 읽을 수 없는 경우(설정 실수 안내용) */
export function appUrlInvalid(env = process.env) {
  return typeof env.APP_URL === 'string' && env.APP_URL.trim() !== '' && !parseOrigin(env.APP_URL);
}
