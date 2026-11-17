# 설정 안내

## 키와 실행 주소

로컬 설정은 `.env.local` 하나로 관리합니다. 최초 설치 때만 `.env.example`을 `.env.local`로 복사합니다. 기존 파일이 있으면 필요한 항목만 추가하고 서버를 다시 시작합니다. GitHub에는 `.env.example`만 올립니다.

```dotenv
KAKAO_JAVASCRIPT_KEY=
KAKAO_REST_API_KEY=
PUBLIC_DATA_SERVICE_KEY=
# 포트 변경: npm run dev -- --port 3081
```

| 항목 | 용도와 공개 범위 |
| --- | --- |
| KAKAO_JAVASCRIPT_KEY | 지도 SDK와 장소 검색에 사용하는 브라우저 공개 키 |
| KAKAO_REST_API_KEY | 서버에서만 사용하는 길찾기 키 |
| PUBLIC_DATA_SERVICE_KEY | 서버에서만 사용하는 공공데이터 공통 인증키 |
| 포트 | 기본 3080. Next.js 실행 시 --port로 지정 |

[카카오디벨로퍼스](https://developers.kakao.com/)에서 앱 키를 확인하고, 터미널의 Local 주소를 JavaScript SDK 도메인에 등록합니다. localhost와 127.0.0.1은 서로 다른 주소이며 포트도 일치해야 합니다. 같은 주소와 포트를 사용해야 브라우저의 검색 설정이 유지됩니다. 건강정보는 저장하지 않습니다.

## 운영시간

아래 두 서비스에 모두 활용신청이 승인되어 있어야 합니다.

- [전국 병의원 찾기](https://www.data.go.kr/data/15000736/openapi.do)
- [전국 약국 정보](https://www.data.go.kr/data/15000576/openapi.do)

일반 인증키(Decoding)가 같으면 PUBLIC_DATA_SERVICE_KEY 하나만 사용합니다. 다르면 PUBLIC_DATA_HOSPITAL_KEY와 PUBLIC_DATA_PHARMACY_KEY로 각각 설정합니다.

기관명과 전화번호, 주소 또는 좌표를 대조해 명확하게 한 기관만 일치할 때 시간표를 연결합니다. 같은 이름의 처음 100건을 확인하며, 후보가 너무 많거나 분점 구분이 모호하면 연결하지 않습니다. 원본 시간표는 서버 메모리에 1시간 캐시하고 한국 시간으로 운영 상태를 계산합니다.

카카오맵에 시간이 있어도 공공데이터 시간표가 없거나 기관을 확실히 매칭하지 못하면 표시할 수 없습니다. 알 수 없는 상태에는 상태 배지를 붙이지 않으며, 운영 중 필터에는 확인된 운영 중 기관만 포함합니다. 시간표 누락과 기관 매칭 실패는 상세에서 구분합니다.

등록 요일 시간표 기준이며 임시휴진, 접수 조기 마감, 공휴일 자동 판정은 반영하지 않습니다. 제공된 공휴일 시간표는 상세에 표시합니다. 사진 API와는 별개이며 카카오 등록 사진은 현재 연동하지 않았습니다.

## 현재 위치와 지도 검색

첫 유효 좌표를 받으면 즉시 주변을 검색합니다. 고정밀 watchPosition으로 최대 15초 관찰하고 더 나은 좌표가 오면 보정합니다. 정확도 100m 이내면 일찍 종료합니다. 직접 검색하거나 지도를 옮긴 뒤에는 새 좌표가 검색 범위를 덮어쓰지 않습니다. 화면 이동과 새 위치 요청 시 기존 관찰을 정리합니다.

좌표와 정확도는 브라우저가 반환한 값 그대로입니다. 오차가 크면 Windows 위치 서비스, 데스크톱 앱 접근, 브라우저 사이트 권한, Wi-Fi와 기본 위치를 확인합니다. OS가 잘못 제공하는 좌표를 지도 API로 실제 위치로 바꿀 수는 없습니다. 위치를 받지 못해도 지역 검색과 지도 탐색은 가능합니다.

지도 오른쪽 상단에는 내 위치와 현재 지도에서 재검색 버튼이 있습니다. 지도 재검색은 입력 지역을 지우고 중심 반경 5km를 검색합니다. 검색창 버튼은 입력한 지역이나 기관명을 검색합니다. 지도 숫자는 함께 묶인 검색 결과 수이며 지역 내 전체 기관 수를 보장하지 않습니다.

## 이동 거리와 길찾기

REST API 키로 도보, 대중교통, 자동차 경로를 조회합니다. 출발지는 지도 중심이 아니라 브라우저 위치입니다. 목록에는 실제 경로 거리만 표시하고, 이동수단과 예상 시간, 상세 경로 및 경로선은 길찾기를 눌러야 펼칩니다. 조회 실패나 위치 미확인 시 직선거리나 임의 시간으로 대신하지 않습니다.

불러온 기관마다 경로를 요청하므로 결과 15개면 해당 수단에서 최대 15건이 발생할 수 있습니다. 동시 요청은 2건으로 제한하고 동일 경로는 2분간 재사용합니다. 대중교통은 API의 첫 경로를 사용합니다. 다른 경로 확인이나 출발지 직접 지정은 카카오맵으로 연결합니다.

## 문제 해결

| 증상 | 확인할 내용 |
| --- | --- |
| 지도 로딩 실패 | JavaScript 키, 등록 주소와 포트, 인터넷 연결 |
| 거리 표시 안 됨 | REST API 키, API 권한과 호출 한도, 현재 위치 |
| 운영시간 표시 안 됨 | 활용신청 승인, 인증키, 기관 매칭과 시간표 누락 |
| 실행했는데 변경 없음 | 서버 종료 후 다시 시작, 실제 포트 확인, Ctrl+F5 |
| 위치가 크게 다름 | OS와 브라우저 위치 설정, 기본 위치, Wi-Fi 상태 |

Next.js가 프로젝트 루트의 .env를 읽습니다. 기존 키 이름을 유지하며 NEXT_PUBLIC_ 접두사를 REST·공공데이터 키에 붙이지 않습니다. 브라우저에는 /api/config를 통해 JavaScript 키와 기능 사용 가능 여부만 전달합니다.

키는 `.env.local`에만 보관합니다. REST와 공공데이터 키 원문은 공개 설정이나 정적 파일로 전달하지 않습니다.

## 공식 자료

- [지도 Web 가이드](https://apis.map.kakao.com/web/guide/)와 [장소 검색 응답](https://developers.kakao.com/docs/ko/local/dev-guide)
- [도보와 대중교통](https://developers.kakao.com/docs/ko/kakaomap/rest-api), [자동차 경로](https://developers.kakaomobility.com/guide/navi-api/directions)
- [위치 관찰 API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition), [Windows 위치 정확도](https://learn.microsoft.com/en-us/uwp/maps-and-location/guidelines-and-checklist-for-detecting-location)
