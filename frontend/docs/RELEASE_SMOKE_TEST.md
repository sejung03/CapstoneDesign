# 모바일·배포 점검

1. PC Chrome의 개발자 도구에서 360px, 390px 기준으로 시작 화면, 동의, 질문·선택지, 지도·목록 및 내 정보의 잘림과 스크롤을 확인한다.
2. Vercel Preview에 필요한 환경 변수와 앱 URL을 설정한다. Supabase에는 Preview의 앱 콜백 URL을 허용하고, 카카오맵 JavaScript 키에 해당 웹 도메인을 등록한다. Preview의 신규 계정 등록은 정책 준비 상태에 따른 기존 운영 제한을 적용한다.
3. 일반 모바일 브라우저에서 계정 A로 로그인하고 내 정보에서 로그아웃한다. 30분 안에 다시 카카오로 계속하기를 누르고 카카오 로그인 화면에서 계정 B로 접속한다. A의 건강정보가 남아 있지 않아야 한다. 카카오톡 인앱 브라우저는 강제 재인증 미지원이므로 별도 확인한다.
4. 배포에 앞서 `app.health_profile.sex`가 nullable이고 `female`, `male`, `unknown`을 받을 수 있는지 확인한다. 없으면 `data_pipeline/db/migrations/006_health_profile_sex.sql`을 실제 DB 관리자와 적용한다. 다른 이름이나 기존 enum을 쓰고 있다면 기존 스키마에 맞춰 API 매핑한다. 저장·다시 로그인·PDF 내보내기·삭제를 점검한다.
5. 실제 휴대폰에서 녹음 권한 요청, 첫 음성 전송, 문진 선택지 음성 응답, 후속 질문 TTS와 음량 조절을 확인한다. 첫 화면 질문 읽기는 없어도 된다.
6. 전화 화면은 로컬 개발 환경에서 `emergencyCallHref`를 테스트 담당자가 관리하는 일반 전화번호로 임시 교체해 확인한다. 다이얼러가 열리고 번호가 맞는지만 확인한 후 눌러 걸지 않고 닫는다. 실제 119로 시험 통화를 하지 않는다. 배포에는 `tel:119`를 유지한다.
7. 정식 개인정보처리방침과 운영 회원가입 활성화 전에는 운영 주체, 문의·권리 행사 창구, 실제 보관·삭제 정책, 외부 처리 및 국외 이전 해당 범위를 확정한다. 문진 OpenAI와 Preview 음성 인식의 사용 범위를 구분한다. 계정에 상담별 분석서를 저장하는 기능은 현행 UI에서 동의를 받지 않는다.

실제 dotenv 파일과 예제를 대조하려면 Windows CMD의 저장소 루트에서 다음 명령을 실행한다. 파일명과 변수명만 출력하며 원본 파일을 수정하지 않는다.

```cmd
node -e "const fs=require('node:fs'),p=require('node:path'),u=require('node:util');for(const d of ['.','frontend','care_engine','data_pipeline','voice_service'])for(const f of ['.env','.env.local','.env.development','.env.development.local','.env.production','.env.production.local']){const n=p.join(d,f);if(fs.existsSync(n))console.log(n+'\u003a '+Object.keys(u.parseEnv(fs.readFileSync(n,'utf8'))).filter(k=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).sort().join(', '))}"
```
