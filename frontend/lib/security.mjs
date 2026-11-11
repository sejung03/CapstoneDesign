export function contentSecurityPolicy(nonce,{development=false}={}){
 return ["upgrade-insecure-requests","default-src 'self'",`script-src 'self' 'nonce-${nonce}'${development?" 'unsafe-eval'":''} https://dapi.kakao.com https://*.daumcdn.net https://*.kakaocdn.net`,"style-src 'self' 'unsafe-inline'","font-src 'self'","img-src 'self' https: data:","connect-src 'self' https://dapi.kakao.com"+(development?" ws://127.0.0.1:* ws://localhost:*":''),"worker-src 'self'","frame-src https://www.youtube-nocookie.com","frame-ancestors 'none'","base-uri 'self'","form-action 'self'"].join('; ');
}
