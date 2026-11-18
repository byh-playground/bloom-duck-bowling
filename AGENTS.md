# 덕 볼링 작업 안내

작업을 시작하기 전에 [BLOOM 공통 작업 규칙](https://github.com/byh-playground/bloom-reference/blob/main/AGENTS.md)을 읽고, 상황에 맞는 상세 절을 따릅니다. 공통 규칙의 원문을 이 저장소에 복제하지 않습니다.

- 엔트리는 루트 `index.html`, 원본은 `src/`와 `styles/`입니다. 게임을 실행하거나 배포하기 위한 생성·번들 단계는 두지 않습니다.
- 공통 실행·표현 기능을 더하기 전에 [GameKit 모듈 색인](https://github.com/byh-playground/bloom-gamekit#readme)을 확인합니다. 공용 모듈은 `index.html` import map의 불변 dist 커밋으로 가져옵니다.
- 게임 버전은 `index.html`의 `#product-version`에서 관리합니다. 공통 PM-001·PM-002를 따라 버전을 판정하고, 로딩과 홈에서 같은 요소를 표시합니다.
- 상태 및 파일의 책임은 [구조 문서](docs/architecture.md)를 따릅니다.
- 작업 브랜치 검증 후 `main` 대상 PR을 사용합니다. 커밋과 작업 문서는 한국어로 씁니다.
- 포맷과 정적 검사는 DEV-028~031을 따릅니다. 덕 볼링의 PR CI는 변경된 JavaScript(`.js`, `.mjs`, `.cjs`)의 문법만 확인하며 패키지 설치, 포맷·린트, 테스트는 실행하지 않습니다. 포맷·린트는 필요할 때 로컬에서 `npm run check` 또는 `BASE_SHA=<기준 커밋> npm run check:changed`로 확인합니다.
- PM-009에 따라 수동 로컬 `npm test`에는 재사용하는 사용자 흐름만 남깁니다. 1회용 검증 코드·로그·스크린샷을 커밋하지 않습니다.
- 릴리즈 채널은 PM-005를 따릅니다. 공개 배포와 Stable 승격은 별도 결정입니다. 내부 정리만으로 제품 버전을 올리지 않습니다.
