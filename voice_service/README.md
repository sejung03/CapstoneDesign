# 로컬 한국어 음성 대화

기존 Next.js 프런트엔드와 별도로 Python 음성 서버를 실행합니다. 음성 입력은 faster-whisper로 받아쓰고, 음성 출력은 Windows의 한국어 음성으로 WAV를 생성합니다. 진료과와 의료기관 검색은 기존 care 엔진과 검색 기능을 사용합니다.

## Windows에서 실행

Python 3.11 x64와 기존 프런트엔드가 요구하는 Node.js 버전(예: 24.15.0)을 준비하세요. Windows **설정 → 시간 및 언어 → 음성**에서 한국어 음성을 설치하세요. 첫 실행 전에는 아래 명령으로 음성 서버 가상환경과 프런트엔드 의존성을 준비합니다. 이미 준비한 PC에서는 저장소 루트에서 `dev.cmd`만 실행하면 됩니다. 음성 서버와 프런트엔드가 각각 새 CMD 창에서 시작되며, 각 창에서 시작 완료 로그가 뜨면 브라우저를 열면 됩니다. 종료할 때는 각 창에서 `Ctrl+C`를 누릅니다.

수동으로 실행하려면 아래 두 명령 묶음을 저장소 루트의 서로 다른 PowerShell 창에서 실행합니다. 두 서버를 수동으로 이미 띄웠다면 종료한 뒤 `dev.cmd`를 실행하세요.

음성 서버

```powershell
Set-Location voice_service
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn service:app --host 127.0.0.1 --port 3091 --no-access-log
```

프런트엔드

```powershell
Set-Location frontend
npm ci
$env:NEXT_PUBLIC_VOICE_ENABLED = '1'
npm run dev
```

브라우저에서 [http://127.0.0.1:3080](http://127.0.0.1:3080)을 여세요. 프런트엔드 환경 변수 `APP_URL`을 설정했다면 브라우저 주소와 일치해야 합니다. 3091 포트가 사용 중이면 음성 서버의 `--port`와 프런트엔드의 `$env:VOICE_SERVICE_PORT`를 같은 다른 포트로 지정하세요. faster-whisper의 기본 `base` 모델은 첫 녹음 처리 시 내려받습니다. 최초 대기 시간을 줄이려면 음성 서버를 시작하는 창에서 설치 후 다음 명령으로 미리 받으세요.

```powershell
.\.venv\Scripts\python.exe -c "from service import whisper_model; whisper_model()"
```

필요하면 음성 서버의 `VOICE_WHISPER_MODEL`에 다른 다국어 faster-whisper 모델명이나 모델 디렉터리를 지정할 수 있습니다. 실제 의료기관 검색을 위한 키는 기존 [프런트엔드 설정 문서](../frontend/docs/SETUP.md)를 참고하세요.

## 로컬 확인 순서

1. 채팅 전송 버튼 옆의 마이크 아이콘을 누릅니다. 건강정보 이용에 동의하고 마이크를 허용한 뒤 한국어로 말해 보세요. 말을 멈추면 녹음이 끝나며, 정지 아이콘으로 직접 끝낼 수도 있습니다. 최대 녹음 시간은 25초입니다.
2. 자동 전송 전에 받아쓴 문장을 확인하고, 필요하면 고치거나 취소 아이콘을 누르세요. 문진 중에는 선택지 문구나 “두 번째”처럼 순서를 말할 수 있습니다. 한 선택지로 확인되지 않으면 화면에서 직접 골라 주세요. 답변은 **음성으로 듣기**로 재생할 수 있습니다.
3. 챗봇이 제안한 검색을 적용하면 추천 의료기관 목록과 기관명 읽기 버튼이 나타납니다.
4. 음성으로 “119에 전화해 주세요”라고 요청하면 기존 긴급 도움 화면이 열립니다. 마이크 없이 **긴급 도움** 버튼으로도 열 수 있습니다. 모의 테스트에서는 화면과 링크만 확인하세요. 전화·문자 링크는 기기의 연결 앱을 열며, 실제 발신 또는 전송은 해당 앱에서 사용자가 합니다. 말하기 어려우면 문자 앱에 현재 위치와 상황을 적어 보낼 수 있습니다. [소방청 다매체 신고 안내](https://www.nfa.go.kr/nfa/news/pressrelease/press/?cntId=2706&mode=view&pageIdx=16)

## 마이크가 말을 인식하지 못할 때

Windows에서 실제 마이크를 테스트하고, Chrome 마이크 설정에서도 같은 입력을 선택하세요. 오디오 인터페이스를 쓰는 경우 마이크가 꽂힌 아날로그 입력을 지정합니다. 루프백 입력은 장치 설정에 따라 PC 재생 소리를 받을 수 있습니다.

## 음성 요청이 503을 반환할 때

개발자 도구의 Network에서 실패한 요청의 경로와 응답의 `detail`을 확인합니다.

| 응답 | 확인할 내용 |
| --- | --- |
| `voice_service_unavailable` | Python 음성 서버가 켜져 있고 프런트엔드에서 설정한 포트와 일치하는지 확인합니다. |
| `invalid_voice_port` | 프런트엔드의 `VOICE_SERVICE_PORT` 값을 수정합니다. 기본값은 3091입니다. |
| `stt_unavailable` | 음성 서버 콘솔과 faster-whisper 모델 설치 상태를 확인합니다. |
| `korean_voice_missing` | Windows 음성 설정에서 한국어 음성을 설치합니다. |

`/api/auth/…`에서 발생한 503은 로그인·가입 경로의 문제이므로 음성 서버를 실행해도 해결되지 않습니다.

## 모듈 구조

- `frontend/components/voice-controls.jsx`에 녹음과 재생 UI가 있으며, 기존 대화 화면에서 재사용합니다.
- `frontend/voice-client.mjs`에서 같은 출처의 `POST /api/voice/stt`와 `POST /api/voice/tts`를 호출합니다.
- STT는 WebM, MP4, Ogg, WAV를 받아 `{"text":"…"}`를 반환합니다. 최대 4MiB 및 30초의 디코딩 한도가 있습니다.
- TTS는 최대 1,000자의 `{"text":"…"}`를 받아 `audio/wav`를 반환합니다. 현재 TTS는 Windows 한국어 음성을 사용합니다.
- `voice_service/service.py`에서 녹음과 생성된 WAV를 요청 처리 중 메모리에서 다룹니다. 서버는 로컬 루프백에 바인딩합니다.
- `frontend/emergency-contact.mjs`에 119 링크와 명시적 한국어 음성 요청 판별을 둡니다. 응급 판단과 안내는 기존 care 엔진과 긴급 도움 화면에서 처리합니다.

모델 문서와 플랫폼 API는 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)와 [Windows SpeechSynthesizer](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer)를 참고하세요.
