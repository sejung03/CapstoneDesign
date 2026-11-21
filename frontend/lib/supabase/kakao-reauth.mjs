export const kakaoReauthCookie='capstone-kakao-reauth';
export function kakaoQueryParams(reauth,userAgent=''){
 // Kakao does not support prompt=login in the KakaoTalk webview.
 return {scope:'',...(reauth==='1'&&!/KAKAOTALK/i.test(userAgent??'')?{prompt:'login'}:{})};
}
