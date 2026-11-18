# 로컬 한국어 음성 대화

기존 Next.js 프런트엔드와 별도로 Python 음성 서버를 실행합니다. 음성 입력은 faster-whisper로 받아쓰고, 음성 출력은 Windows의 한국어 음성으로 WAV를 생성합니다. 진료과와 의료기관 검색은 기존 care 엔진과 검색 기능을 사용합니다.

## Windows에서 실행

Python 3.11 x64와 기존 프런트엔드가 요구하는 Node.js 버전(예: 24.15.0)을 준비하세요. Windows **설정 → 시간 및 언어 → 음성**에서 한국어 음성을 설치하세요. 아래 두 명령 묶음은 저장소 루트의 서로 다른 PowerShell 창에서 실행합니다.

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

1. 건강정보 이용 안내를 확인한 뒤 마이크 권한을 허용합니다. **음성 입력**을 누르고 한국어로 말한 뒤 **녹음 끝내기**를 누릅니다. 녹음은 25초 후 자동 종료됩니다.
2. 입력란의 받아쓴 문장을 확인하고 전송합니다. 챗봇의 추가 질문과 진료과 추천은 **음성으로 듣기**로 재생할 수 있습니다. 자동 재생을 차단하는 브라우저에서는 표시된 플레이어의 재생 버튼을 누릅니다.
   추가 질문에서 “응, 괜찮아”처럼 음성으로 답하고 전송하면, 현재 질문의 “예, 괜찮아요”처럼 하나로 일치하는 선택지가 적용됩니다.
3. 챗봇이 제안한 검색을 적용하면 추천 의료기관 목록과 기관명 읽기 버튼이 나타납니다.
4. 음성으로 “119에 전화해 주세요”라고 요청하면 기존 긴급 도움 화면이 열립니다. 마이크 없이 **긴급 도움** 버튼으로도 열 수 있습니다. 모의 테스트에서는 화면과 링크만 확인하세요. 전화·문자 링크는 기기의 연결 앱을 열며, 실제 발신 또는 전송은 해당 앱에서 사용자가 합니다. 말하기 어려우면 문자 앱에 현재 위치와 상황을 적어 보낼 수 있습니다. [소방청 다매체 신고 안내](https://www.nfa.go.kr/nfa/news/pressrelease/press/?cntId=2706&mode=view&pageIdx=16)

## 모듈 구조

- `frontend/components/voice-controls.jsx`에 녹음과 재생 UI가 있으며, 기존 대화 화면에서 재사용합니다.
- `frontend/voice-client.mjs`에서 같은 출처의 `POST /api/voice/stt`와 `POST /api/voice/tts`를 호출합니다.
- STT는 WebM, MP4, Ogg, WAV를 받아 `{"text":"…"}`를 반환합니다. 최대 4MiB 및 30초의 디코딩 한도가 있습니다.
- TTS는 최대 1,000자의 `{"text":"…"}`를 받아 `audio/wav`를 반환합니다. 현재 TTS는 Windows 한국어 음성을 사용합니다.
- `voice_service/service.py`에서 녹음과 생성된 WAV를 요청 처리 중 메모리에서 다룹니다. 서버는 로컬 루프백에 바인딩합니다.
- `frontend/emergency-contact.mjs`에 119 링크와 명시적 한국어 음성 요청 판별을 둡니다. 응급 판단과 안내는 기존 care 엔진과 긴급 도움 화면에서 처리합니다.

모델 문서와 플랫폼 API는 [faster-whisper](https://github.com/SYSTRAN/faster-whisper)와 [Windows SpeechSynthesizer](https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer)를 참고하세요.
