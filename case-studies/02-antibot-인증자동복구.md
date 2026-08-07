# 로그인해야 보이는 이벤트 — 봇으로 몰리지 않고 세션을 자동으로 지키는 법

> 케이스 스터디 ② · K-pop 이벤트 스크래퍼 (64개 쇼핑몰, 단독 운영)
> 모든 수치·커밋은 스크래퍼 repo 에서 확인. 커밋 해시·파일 경로 명시.

## 한 문단 요약

이벤트 중 상당수는 **로그인해야** 보인다 — 회원 전용 목록이거나, 주문서(구글폼의 입력이 되는
결제창 항목)를 실제로 열어봐야 하기 때문이다. 그런데 자동화로 로그인을 하려는 순간 세 종류의
벽에 막힌다: (1) 쇼핑몰의 **봇 감지**가 자동 브라우저 자체를 차단하고, (2) cafe24 같은 플랫폼은
반복 로그인을 **보이지 않는 안티봇**으로 잠그며, (3) 어렵게 얻은 세션도 **조용히 만료**돼
결제창에서 로그인 화면으로 튕긴다. 이 글은 이 세 벽을 각각 **실브라우저 캡처 · 자극하지 않는
자동복구 · 닫힌 루프 에스컬레이션**으로 넘긴 설계 기록이다. (참고로 이 과정에서 "자동 로그인 25개
샵"이라는 내 초기 메모가 틀렸음을 코드로 재확인해 **23개**로 바로잡았다 — §6.)

---

## 1. 문제 — 로그인 자동화를 막는 세 겹의 벽

스크래퍼는 로그인 세션이 필요한 샵을 위해 자격증명·쿠키·`storageState`(쿠키 + localStorage)를
보관하고, 스크랩/결제창 측정 때 주입한다. 문제는 **세션을 얻고 유지하는 것 자체**가 어렵다는 것이다.

- **벽 ①(봇 감지)** — ktown4u·linc_fan_shop(stayge SSO)·bizent·nemozshop 등은 Playwright 로
  띄운 브라우저를 **stealth 를 붙여도** 봇으로 감지해 막는다. 자동 로그인 시도 자체가 성립하지 않는다.
- **벽 ②(리스크 기반 안티봇)** — cafe24/makeshop/godo 계열은 짧은 시간에 반복 로그인하면 **보이지
  않는** `CheckCaptcha`/단일세션 무효화로 ~15분 잠금을 건다. "로그인 코드를 고치려고 반복 테스트"
  하는 것만으로 계정을 잠가버려, 제대로 고친 코드조차 세션을 못 만든다.
- **벽 ③(조용한 만료)** — 어렵게 캡처한 세션도 쿠키가 시간이 지나며 빠져(decay) 어느 날 결제창에서
  `/member/login` 으로 튕긴다. 단독 운영이라 **사람이 매번 다시 로그인할 수 없다** — 자동으로
  감지하고 복구해야 한다.

세 벽은 성격이 달라서 **하나의 해법으로 못 넘는다.** 각각에 맞는 대응을 설계했다.

---

## 2. 벽 ① 대응 — 실브라우저 CDP 캡처 (로그인 방법의 기본이 됨)

봇 감지의 정공법은 **"봇처럼 안 보이는 브라우저"를 만드는 것이 아니라, 이미 로그인을 통과한 진짜
브라우저의 세션을 그대로 가져오는 것**이다. 운영자가 자기 실브라우저(Chrome/Whale)에서 대상 샵에
로그인하면 — 그건 진짜 브라우저라 봇 감지를 이미 통과했다 — 스크래퍼가 그 브라우저에 **원격 디버깅
(CDP)으로 붙어** 세션을 읽어온다.

```text
운영자 실브라우저 (이미 로그인 통과, 봇 감지 무관)
        │  --remote-debugging-port=9222
        ▼
scripts/capture-via-cdp.js  ── connectOverCDP ──▶  storageState 저장
        │                                          (쿠키 + 탭별 localStorage)
        ▼
storage-state.secret/<shop>.json  ──▶  스크랩·결제창 측정 때 주입
```

- 도구: `scripts/capture-via-cdp.js`(최초 커밋 `408e7fe`, 2026-06-15) → 현재는 공용
  `main/_cdp-capture.js` 로 로직 이전(앱 내 "로그인 캡처" 버튼과 CLI 가 같은 구현 공유).
- 저장물은 **`storageState`** — 쿠키뿐 아니라 **탭별 localStorage** 까지. ktown4u·linc 처럼 세션
  토큰을 쿠키가 아닌 **localStorage 의 Bearer 토큰**으로 들고 있는 샵은 쿠키만 복사하면 로그인이
  안 되기 때문이다(`_cdp-capture.js:259` — CDP `storageState()`는 쿠키만 잡아서 localStorage 는
  탭을 돌며 직접 읽어 병합).
- 운영자의 실브라우저 **창은 닫지 않는다**(연결만 붙었다 뗀다). 왜 CDP 가 기본인지는 코드 주석에
  명시돼 있다(`capture-via-cdp.js:3`): *"봇 보호 샵은 Playwright 로 띄운 어떤 브라우저도 막고, 최신
  쿠키 DB 는 앱 바운드 암호화를 쓴다 → 견고한 경로는 운영자가 자기 브라우저에서 로그인하는 것.
  봇 감지도 복호화도 없다."* 예전의 앱 내 Electron 로그인 창은 cafe24/makeshop 안티봇에 막혀
  노이즈 쿠키만 잡았고, 이걸 대체했다(`login-capture.js:4`).

### 조용히 auth 쿠키를 누락하던 버그 (`bb42247`, 2026-07-07)

CDP 캡처에는 **재현 가능한 함정**이 하나 있었다. 완전히 로그인해서 재캡처해도 주문서에서 계속
로그인 화면으로 튕겼다. 원인은 접속 주소 한 글자 차이였다:

```js
// main/_cdp-capture.js:247 (요약 주석)
// ⚠️ localhost 를 써라. 127.0.0.1 이 아니라.
//   connectOverCDP 에서 둘은 같은 브라우저의 "서로 다른 쿠키 뷰"에 붙는다 —
//   localhost = 라이브 탭 컨텍스트(로그인 직후의 fresh auth 쿠키),
//   127.0.0.1 = stale whole-store 뷰 → 핵심 member 쿠키를 누락.
//   (dearmymuse: localhost 44/32 auth 포함 vs 127.0.0.1 3405/26 누락 — 결정적 재현)
const b = await chromium.connectOverCDP(`http://localhost:${port}`);
```

같은 브라우저인데 `localhost` 로 붙으면 로그인 직후의 신선한 member 세션 쿠키(cafe24 의
`ec_mem_level` 등)를 잡고, `127.0.0.1` 로 붙으면 오래된 whole-store 뷰라 **그 쿠키들을 빠뜨린다.**
게다가 쿠키는 raw `Storage.getCookies`(브라우저 레벨, stale) 말고 Playwright
`contexts()[0].storageState().cookies`(컨텍스트 실제 jar)로 읽어야 auth 쿠키가 온전히 들어온다.
이 두 가지를 고쳐(`bb42247`) 재캡처가 신선한 세션을 확실히 잡게 했다. 절차 런북은
`FUTURE_PROBE_WORK.md` §B·§E 에 있다.

---

## 3. 벽 ② 대응 — cafe24 안티봇을 "자극하지 않기"

봇 감지가 브라우저를 막는다면, cafe24 의 리스크 기반 안티봇은 **행동 패턴**을 막는다. 여기서
해법은 기술이 아니라 **절제**다 — 반복·오탐·조급함을 코드로 억제한다.

**(1) 반복하지 않는다 — 플랫폼 스로틀.** cafe24/makeshop/godo 는 자동 재로그인 대상에서 빼고,
수동 재시도조차 스로틀한다.

```js
// main/ipc-handlers.js:2388 (요약)
// 리스크 기반 안티봇(cafe24/makeshop/godo): 짧은 시간 반복 로그인 시
// 보이지 않는 CheckCaptcha/단일세션으로 ~15분 잠금이 걸린다.
const ANTIBOT_LOGIN_PLATFORM = /^(cafe24|makeshop|godo)/;
const MANUAL_LOGIN_THROTTLE_MS = 60 * 1000;
```

만료가 감지돼도 이 계열은 **자동 로그인을 시도하지 않고 알림만** 띄운다(`login-capture-auto.js` —
샵당 최소 재시도 간격 20시간, 사실상 "자동으로는 안 함, 사람에게 알림"). 안티봇을 트리거하느니
사람 한 번 부르는 게 낫다.

**(2) 오탐하지 않는다 — 엄격한 로그인 성공 판정 (`d715a79`).** 처음엔 로그인 성공을 느슨한 정규식
(`마이페이지|주문조회|회원정보 …`)으로 판정했는데, 이 단어들은 **로그아웃 상태의 헤더에도** 있다.
그래서 로그인이 실패했는데도 "성공"으로 오판해 **익명 쿠키를 유효한 세션인 양** 저장하는 사고가
났다. 판정을 엄격하게 바꿨다:

```js
// main/auto-relogin.js:33, :324
const COMMON_SUCCESS = /로그아웃|Sign\s?Out|Log\s?-?\s?Out/i;   // "로그아웃"이 보인다 = 로그인됨
const loggedIn = !bouncedToLogin && spec.successText.test(bodyText);  // + 로그인 페이지로 튕겼나(음성 신호)
```

"로그아웃" 링크는 **로그인했을 때만** 보인다 — 이걸 성공 신호로, 로그인 페이지 바운스를 실패
신호로 이중 확인한다.

**(3) 헛클릭하지 않는다 — decoy 앵커 Enter 폴백 (`9870f1c`, 2026-06-05 진단).** cafe24 로그인 폼에서
generic `a:has-text("로그인")` 셀렉터가 진짜 로그인 링크가 아니라 **네비게이션의 미끼(decoy) 앵커**를
먼저 잡아, 클릭해도 POST 가 안 나갔다. 비밀번호 칸에서 **Enter 로 제출하는 폴백** + 샵별
`submitSelectors` 오버라이드로 해결했다.

---

## 4. 벽 ③ 대응 — 조용한 만료의 닫힌 루프 자동복구 (`26d5634`)

세션은 반드시 만료된다. 관건은 **만료를 스스로 감지하고, 안티봇을 건드리지 않는 속도로 복구하며,
안 되면 물러나 사람을 부르는** 닫힌 루프다. `main/auth-recovery.js`(커밋 `26d5634` "인증 자동복구
닫힌 루프 — 실패 에스컬레이션·가시화·수동 해제")가 이 상태 기계다.

**언제 복구하나 (감지).** 스크랩/스케줄러가 도는 sweep 이 각 샵의 상태를 본다 —
shop-health 가 `session_expired` 이거나 쿠키 건강도가 `expired`/`likely-expired` 이면 복구 대상
(`ipc-handlers.js:2675` `needsRelogin`).

**얼마나 물러서나 (에스컬레이션).** 실패할수록 쿨다운을 늘리고, 3연속 실패면 자동 재시도를 멈춘다:

```js
// main/auth-recovery.js:21-26
const COOLDOWN_BY_FAILCOUNT = [
  6 * 60 * 60 * 1000,   // 성공 직후/첫 시도: 6h (안티봇 보호 — 성공해도 6h 안엔 재시도 안 함)
  6 * 60 * 60 * 1000,   // 1회 실패 후: 6h
  24 * 60 * 60 * 1000,  // 2회 실패 후: 24h
];
const MANUAL_DISABLE_AFTER_FAILS = 3;   // 3연속 실패 → disabledUntil:'manual'
```

```text
성공 ──▶ failCount=0, 6h 바닥(안티봇 보호)
1회 실패 ──▶ 6h 후 재시도
2회 실패 ──▶ 24h 후 재시도
3회 실패 ──▶ 'manual' — 사람이 [재시도 허용] 누를 때까지 자동 재시도 정지
성공하면 즉시 리셋(failCount=0, disabledUntil=null)
```

핵심은 **성공해도 6h 바닥**을 둔 것이다 — 세션이 멀쩡한데도 자주 재로그인하면 그 자체가 안티봇을
부르므로, "필요할 때만, 드물게"를 강제한다. 3연속 실패 시 `'manual'` 로 못박아, 깨진 계정에
무한 재시도해 잠금을 악화시키는 걸 막는다. (구형 kv `autoReloginAttempts` 는 새 `autoReloginState`
로 자동 마이그레이션.)

**어떻게 사람에게 넘기나 (가시화).** sweep 결과는 kv `lastAuthRecoveryReport` 로 저장돼 UI
`AuthRecoveryStatus` 패널(쿠키 건강 패널 안)에 뜨고, `[재시도 허용]` 버튼으로 수동 해제할 수 있다.
실패가 있으면 데스크톱 알림 `authRecoveryFailed` 가 뜬다(24h 스로틀, 방금 `'manual'` 로 막힌
건은 한 번은 즉시 통지). 자동복구가 **조용히 실패하지 않게** — 닫힌 루프의 마지막 고리다.

이 설계는 유닛 테스트(`tests/unit/auth-recovery*.test.js`)로 에스컬레이션·리셋·게이트가 검증된다.
파일 이력은 도입(`26d5634`) + 방어 보강(`d715a79`, 감사에서 "failCount≥3인데 시각이 비면 무한
24h 재시도로 새는" F10 결함 수정) 두 커밋뿐이다.

---

## 5. 전체 로그인 체계 — 4가지 메커니즘

세 벽에 대한 대응이 모여, 샵의 인증 방식에 따라 **4가지 로그인 메커니즘**이 된다.

| 메커니즘 | 대상 | 근거 |
| --- | --- | --- |
| ① 자동 폼 채움 (자격증명 복호화 → 로그인) | cafe24/Shopify 등 표준 폼 20개 샵 | `auto-relogin.js` `performLogin`, `LOGIN_SPECS` |
| ② `storageState` 주입 (쿠키+localStorage) | localStorage/Bearer 토큰 SSO 샵 (ktown4u·minirecord) | `scraper-dynamic.js:97`, `checkout-probe.js:2367` |
| ③ 실브라우저 CDP export | 봇 감지 샵 (ktown4u·linc·bizent·nemoz) | `_cdp-capture.js`, §2 |
| ④ 수동 SSO 캡처 (`manualOnly`) | 2-step/소셜 SSO 3개 샵 (makestar·bstageplus·mymusictaste) | `auto-relogin.js:296` |

주입은 **`storageState` 우선, 쿠키 리플레이는 폴백**이다 — `storage-state.secret/<id>.json` 이
있으면 그걸(쿠키+localStorage+IndexedDB) 컨텍스트에 주입하고, 없을 때만 쿠키를 넣는다
(`checkout-probe.js:2440`). SSO/Bearer 샵은 쿠키만으론 로그인이 안 되므로 이 우선순위가 중요하다.
(`storage-state.secret/` 는 gitignore — 세션 비밀은 저장소에 안 올라간다.)

진단 도구도 갖췄다: `scripts/relogin-bridge.js`(헤드리스 재로그인 → 결제 프로브가 보는
`cookies.secret.json` 으로 세션 브리지), `scripts/probe-one.js`(단일 샵 결제창 도달을 CLI 로 재현).

### 정직한 커버리지 — "25"가 아니라 23

이 글을 쓰며 **내 메모의 "자동 로그인 25개 샵"이 틀렸음을 코드로 확인**했다. 실제 `LOGIN_SPECS`
(자동 재로그인 레지스트리, `auto-relogin.js:65`)는 **23개**이고, 그중 **20개가 헤드리스 자동
로그인**, **3개는 `manualOnly`**(SSO/2-step 라 자동 폼이 안 먹음)다. `requiresAuth` 를 켠 샵 모듈은
**28개**(그중 5개는 LOGIN_SPECS 밖 — SSO/토큰형이라 ②③ 경로). "25"는 코드가 아니라 초기 기획
문서(`docs/archive/cookie-track-guide.md` "회원전용 25개 샵 … 약 20개 자동 회복 가능")의 **대상
목록 수**였고, 등록된 자동 로그인 스펙 수가 아니었다. 포트폴리오에는 **코드로 재확인한 23/20/28**만
싣는다.

---

## 6. 배운 것

1. **봇 감지는 "더 은밀한 봇"으로 못 이긴다 — 진짜를 빌린다.** stealth 로 자동 브라우저를 위장하는
   군비경쟁 대신, 이미 로그인을 통과한 운영자의 실브라우저 세션을 CDP 로 가져오는 게 가장 견고했다.
   싸울 수 없는 벽은 우회한다.
2. **안티봇 앞에서는 절제가 기능이다.** 반복 스로틀, 성공해도 6h 바닥, 3연속 실패 시 자동 정지 —
   "덜, 드물게, 물러나며"를 코드로 강제한 것이 잠금을 피하는 진짜 방어였다. 조급한 재시도는 복구가
   아니라 악화다.
3. **오탐은 조용한 오염을 만든다.** 느슨한 성공 판정이 **익명 쿠키를 유효 세션으로 저장**해, 눈에
   안 띄는 곳에서 데이터를 썩혔다. 인증 성공 판정은 관대함이 아니라 **엄격함**이 안전하다
   (`로그아웃` 존재 + 로그인 바운스 이중 확인).
4. **같은 브라우저도 접속 경로에 따라 다른 걸 본다.** `localhost` vs `127.0.0.1` 한 글자가 서로 다른
   쿠키 뷰에 붙어 auth 쿠키를 통째로 누락시켰다. "당연히 같겠지"를 의심하고 결정적으로 재현
   (44/32 vs 3405/26)한 것이 버그를 잡았다.
5. **자동복구는 닫힌 루프여야 한다.** 감지 → 백오프 → 실패 시 사람에게 가시화까지 이어져야 "자동"이
   신뢰가 된다. 조용히 실패하는 자동화는 없는 것만 못하다 — 그래서 마지막 고리를 알림·수동 해제로
   닫았다.
6. **자기 수치도 검증 대상이다.** "25개"라고 믿던 커버리지가 코드로 보니 23개였다. 포트폴리오의
   숫자는 기억이 아니라 **재확인한 것**만 싣는다(데모 무결성).

---

### 근거 (repo 대조)

| 주장 | 근거 |
| --- | --- |
| 봇 감지 → 실브라우저 CDP 캡처가 기본 | `scripts/capture-via-cdp.js`(최초 `408e7fe`, 2026-06-15), `main/_cdp-capture.js`, `login-capture.js:4`; 런북 `FUTURE_PROBE_WORK.md` §B·§E |
| storageState = 쿠키 + localStorage(Bearer) | `_cdp-capture.js:259` (localStorage 탭별 병합), ktown4u/linc |
| localhost≠127.0.0.1 auth 쿠키 누락 버그 | `bb42247`(2026-07-07) `_cdp-capture.js:247-253`; dearmymuse 44/32 vs 3405/26 재현 |
| cafe24 안티봇 스로틀 (CheckCaptcha/단일세션) | `ipc-handlers.js:2388` `ANTIBOT_LOGIN_PLATFORM=/^(cafe24\|makeshop\|godo)/`, `MANUAL_LOGIN_THROTTLE_MS=60s`; `login-capture-auto.js`(만료 시 알림-only, 20h) |
| 엄격 로그인 판정 (느슨→`로그아웃` + 바운스) | `d715a79`; `auto-relogin.js:33`·`:324` |
| decoy 앵커 Enter 폴백 | `9870f1c`(2026-06-05 진단); `auto-relogin.js:248-261` |
| 에스컬레이션 6h→24h→manual(3회) + 성공 리셋 | `26d5634`; `auth-recovery.js:21-26`(`COOLDOWN_BY_FAILCOUNT`, `MANUAL_DISABLE_AFTER_FAILS=3`), `:52-81` |
| 트리거·가시화 (sweep·패널·알림·수동해제) | `ipc-handlers.js:2675`(`needsRelogin`)·`2722`(`lastAuthRecoveryReport`), `AuthRecoveryStatus.jsx`, `desktop-alerts.js`(`authRecoveryFailed`) |
| storageState 우선 주입, 쿠키 폴백 | `scraper-dynamic.js:97-105`·`:133`, `checkout-probe.js:2367-2375`·`:2440`; `storage-state.secret/` gitignore |
| 커버리지 23/20/28 ("25"는 기획문서) | `LOGIN_SPECS` 23개(`auto-relogin.js:65`), `manualOnly` 3개, `requiresAuth:true` 28개; `docs/archive/cookie-track-guide.md`(25=대상목록) |

> 정직성 참고: `main/ipc-handlers.js` 는 비텍스트 바이트가 섞여 있어 plain `grep` 이 매칭을 조용히
> 누락한다(`grep -a` 필요) — 이 파일의 sweep/안티봇/쿨다운 배선은 그 방식으로 확인했다.
> `storage-state.secret/`·`cookies.secret.json` 등 세션 비밀 파일은 열지 않고 **주입하는 코드만**
> 검증했다.

_초고 · 2026-08-05 KST. 공개 게시 전 개인정보·API 키 없음 확인._
