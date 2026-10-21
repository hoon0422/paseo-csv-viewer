# Handoff: Ubuntu Cua Space에서 Paseo ARM64/x64 호환성 해결

## Task

ARM64 Ubuntu Cua Space에서 Paseo 데스크톱을 실행할 수 있는 재현 가능한 경로를 **지금 해결하고 실행으로 검증한다**. 문서 조사에서 끝내지 말고, Space 안에 필요한 소프트웨어를 설치해 실제 데스크톱 앱과 독립 로컬 데몬을 띄운다. 사용자는 이 설치와 실험을 명시적으로 허용했다.

이번 위임은 GitHub 이슈 #2 중 CPU 아키텍처와 데스크톱 테스트 환경을 막는 부분에 한정한다. CSV Viewer 기능 구현이나 전체 프로젝트 초기화까지 맡은 것이 아니다.

## Context

- 프로젝트: `/Users/Younghoon/projects/paseo-plugins/csv-viewer`.
- 비공개 GitHub 저장소: https://github.com/hoon0422/csv-viewer
- 원본 명세 #1: https://github.com/hoon0422/csv-viewer/issues/1
- 선행 환경 준비 #2: https://github.com/hoon0422/csv-viewer/issues/2
- 구현 티켓 #3–#10은 이미 생성됐으며 #2가 첫 선행 조건이다.
- 제품은 Paseo 본체 수정이나 포크 없이 설치하는 CSV/TSV 읽기 전용 플러그인이다. 워크스페이스 패널, Command Center, 헤더 버튼이 진입점이다.
- 기본 Files와 OS 파일 관리자에서 열린 패널로 파일을 드롭해야 한다. 외부 드롭은 앱과 데몬이 같은 컴퓨터인 첫 버전 범위다.
- 목표는 최대 5GB, 전체 검색/정렬, 미리보기와 진행 상태, 호스트 임시 디스크 사용이다. 이 기능들은 아직 구현되지 않았다.
- 사용자는 호스트 Mac에서 Paseo를 사용 중이다. 테스트는 독립 Ubuntu Cua Space에서 진행해야 하며 **teleport는 사용할 수 없다**.

## Relevant files

- `AGENTS.md` — tracker/domain 문서를 읽는 진입 규칙.
- `CLAUDE.md` — `AGENTS.md`를 가리키는 상대 심볼릭 링크. 유지할 것.
- `docs/agents/issue-tracker.md` — GitHub 작업 규칙. 모든 `gh` 명령은 escalated permissions로 실행.
- `docs/agents/domain.md` — 문서/용어 규칙.
- 이 문서 — 위임의 단일 브리핑. 해결 후 실제 절차와 증거 위치를 추가한다.
- `/Users/Younghoon/.agents/skills/cua-spaces/SKILL.md` — Cua Space 도구 사용법.
- `/Users/Younghoon/.agents/skills/cua-driver/SKILL.md` 또는 적합한 GUI 스킬 — 실제 GUI를 조작할 때 읽는다. 호스트 GUI가 아니라 Space의 GUI 도구를 사용한다.
- `/Users/Younghoon/.agents/skills/paseo-plugin/SKILL.md` — 후속 플러그인 환경과 런타임 경계 참고. 이번 작업에서 플러그인 구현은 시작하지 않는다.

## Current state

### 직접 확인한 Space

- ID: `local:space-2653f07b52`
- 이름: `space-2653f07b52`
- 이미지: `ghcr.io/trycua/linux:24.04`
- OS: Ubuntu 24.04.5 LTS
- guest 아키텍처: `aarch64` / ARM64
- provider: local, kind: container, spacesd: 0.5.3
- 최근 `space_bash` 실행은 성공했고 DISPLAY가 설정되어 있다. 목록의 power 표시는 서로 일치하지 않는 값이 있어 실제 도구 응답으로 가용성을 확인할 것.
- git, node, npm이 있다. `paseo`, `codex` 실행 파일은 없다.
- `qemu-x86_64`, `qemu-x86_64-static`, `box64` 실행 파일은 guest에서 발견되지 않았다. 이것이 host/runtime의 에뮬레이션 지원 부재를 입증하는 것은 아니다.
- Xvfb와 Xfce/Thunar 데스크톱이 있다.
- 파일시스템 free bytes가 약 2^63의 비현실적인 값으로 보고됐다. 이 숫자만으로 실제 테스트 공간이 충분하다고 판단하지 말 것.

### 직접 확인한 Paseo 배포

- 조사 당시 GitHub 최신 릴리스는 `v0.12.0`이었다. 시작할 때 변경 여부를 다시 확인한다.
- Linux 자산은 `Paseo-0.12.0-amd64.deb`, `Paseo-0.12.0-x86_64.rpm`, `Paseo-x86_64.AppImage`, x64 tarball 등이었고 Linux ARM64 데스크톱 파일은 없었다.
- macOS ARM64와 Windows ARM64 자산이 있다고 해서 Linux ARM64도 제공되는 것은 아니다.
- 릴리스: https://github.com/getpaseo/paseo/releases/tag/v0.12.0

### 저장소와 작업 위치

- 로컬 Git은 main을 가리키지만 **아직 첫 커밋이 없다**.
- `origin`은 `https://github.com/hoon0422/csv-viewer.git`이다.
- 지침과 설정 문서가 untracked이며 플러그인 코드는 없다. 이 파일들을 삭제하거나 덮어쓰지 않는다.
- 현재 Paseo workspace ID: `wks_1fa1a85bc684e408`.
- 지금은 현재 workspace에 별도 에이전트를 두되, 실제 설치/빌드/실험은 Space 안에서 수행한다. 기능 개발용 worktree와 기준 커밋은 전체 #2의 다른 작업이다. 이 위임을 이유로 사용자 작업을 임의 커밋하거나 새 기능 작업을 시작하지 않는다.

## What was tried

- Cua `list_spaces`와 기존 Space의 읽기 전용 `space_bash`로 OS, 아키텍처, 도구, DISPLAY를 확인했다.
- escalated `gh api repos/getpaseo/paseo/releases/latest`로 공식 자산 목록을 읽었다.
- **아직 Paseo 설치, x64 에뮬레이션, 다른 Space 생성, native 빌드, 앱 실행을 시도하지 않았다.** 이를 실패한 접근이라고 기록하지 말 것.
- Node CLI나 웹 UI만으로 외부 OS 파일 드롭을 검증할 수 있다고 결론 내리지 않았다. 데스크톱의 File→경로 기능이 관련되어 실제 Electron 환경이 필요하다.

## Decisions

- 우선 현재 사용 가능한 Cua 배치/이미지/런타임 옵션을 확인하고, 공식 x64 Paseo 패키지를 실행할 수 있는 Ubuntu 환경을 확보한다. 지원되지 않는 `arch` 옵션을 추측해 호출하지 않는다.
- 기존 Space에서 지원되는 호환 런타임을 구성하거나, 적절한 Ubuntu Space를 사용하는 경로를 검토할 수 있다. 기존 Space를 우선 활용하고 필요 없는 실험 환경은 정리한다. 삭제는 자신이 만든 환경에 한정한다.
- 공식 x64 패키지를 실행할 경로가 없다면 **변경하지 않은 upstream 릴리스 소스**를 ARM64에서 빌드하는 경로를 검증할 수 있다. 이것은 테스트용 원본 빌드이며 제품에 필요한 포크/본체 패치를 만드는 것이 아니다. source SHA, 빌드 옵션, 산출물 버전을 기록한다.
- 앱이나 upstream 소스를 수정해야만 실행되는 경로는 현재 제품 요구를 만족한 해결로 보고하지 않는다. 필요하면 더 적절한 실행 환경을 확보한다.
- Space 안의 테스트 Paseo는 독립 데몬/상태/포트를 사용한다. 사용자의 실제 호스트 Paseo로 연결해 검증을 대신하지 않는다.
- 사용자 프로필이나 로그인 정보를 복제하지 않는다. fresh 인증이 정말 필요한 경우 정상적인 로그인 경로를 사용하되, 데스크톱/로컬 데몬 실행 검증에 불필요한 모델 로그인은 요구하지 않는다.

## Acceptance criteria

- [x] 실제 사용할 Ubuntu Space ID, guest 아키텍처와 호환 런타임을 기록했다.
- [x] Space 안에 Paseo 데스크톱을 설치하거나 원본 릴리스에서 빌드했고, 실제 GUI 창이 실행된다. 단순 설치 성공이나 CLI 버전 출력만으로 완료하지 않는다.
- [x] Space 안의 독립 로컬 데몬이 정상 동작하고 데스크톱이 그 데몬에 연결된다. 앱/데몬의 정확한 버전과 산출물 출처를 기록했다.
- [x] 가능하면 작은 합성 CSV를 Thunar에서 기존 Paseo 터미널 등 안전한 내장 대상으로 드롭해 데스크톱의 파일 경로 처리 경로를 검증한다. 아직 없는 CSV 플러그인의 드롭까지 검증했다고 주장하지 않는다. 이 추가 확인이 불가능하다면 이유와 실제 검증 범위를 분리한다.
- [x] 실행 중 창의 스크린샷, launch/daemon 로그, 환경/버전 정보와 반복 실행 절차를 남겼다. 사용자 화면에 증거를 전달할 때 이미지 파일은 실제로 표시한다.
- [x] teleport와 사용자 로그인/프로필 복사 없이 완료했다. 호스트의 실행 중 Paseo와 전역 Codex/Paseo 설정을 변경하지 않았다.
- [x] 이 문서에 해결 방법, 정확한 명령/버전, 남은 한계, 증거 파일 위치를 추가하고 부모 에이전트에 알렸다. #2에 결과를 기록할 수 있으나 CPU 호환성만 해결했다고 #2 전체를 닫지 않는다.
- [x] 해결이 불가능하면 실제 시도와 오류, 남은 정확한 차단 조건을 보고한다. 조사만 한 상태를 실행 성공으로 표현하거나 Linux 결과를 macOS/Windows 검증으로 확대하지 않는다.

## Constraints

- 사용자의 즉시 해결 요청이다. 설치 가능한 경로를 찾으면 권한을 반복해서 묻지 말고 Space 안에서 실행 검증까지 진행한다.
- **모든 `gh` 명령은 escalated permissions로 실행한다.** 인증 토큰이나 keyring 내용을 출력/복사하지 않는다.
- Cua Space 조작은 Cua 도구를 우선 사용한다. 도구를 발견한 후 해당 스키마/문서를 읽고 호출한다.
- **teleport 금지. 호스트의 사용 중인 Paseo 앱/데몬에 대한 설치·리로드·재시작·GUI 실험 금지.**
- 코드와 합성 fixture의 일반 업로드/다운로드는 허용된다. 별도 외부 계정/세션 복제는 허용되지 않았다.
- 현재 저장소의 지침과 심볼릭 링크를 보존한다. 플러그인 기능 구현과 전체 티켓 실행으로 범위를 확장하지 않는다.
- 사용자가 이미 제공한 제약이나 도구로 확인할 수 있는 사실을 다시 묻지 않는다.
- 성공 후 agent/workspace/Space ID와 실제 검증 범위를 보고한다. 이 작업은 별도 새 에이전트에 위임되며, 부모는 완료를 폴링하지 않는다.

## Result

**해결 및 실제 실행 검증 완료: Mac ARM64 → QEMU x86_64 Ubuntu VM → 공식 Paseo amd64 패키지.** 검증일은 2026-10-20 America/Toronto이며 로그는 2026-10-21 UTC를 사용한다. 이슈 #2 중 CPU 호환성·독립 데스크톱 테스트 환경 부분만 완료했다. #2 전체는 열어 둔다.

### 최종 사용자 지시와 원본 보존

사용자의 후속 지시가 위 Decisions의 소스 빌드 대안을 대체한다: **Paseo를 소스로 빌드하지 않고, Mac에서 x64 Linux를 실행하여 공식 바이너리를 설치한다.** 이 지시 전에 원본 태그 clone과 `npm ci`를 시작했지만 소스 편집이나 Paseo 빌드는 실행하지 않았다. 설치를 중단하고 제가 생성한 임시 ARM64 Space `local:paseo-arm64-verify`를 삭제했다. 최종 환경에는 소스 checkout이나 자체 빌드 산출물을 사용하지 않았다.

공식 `.deb`의 SHA-256이 GitHub 릴리스 게시값과 일치한다. 설치 후 `dpkg --verify paseo`도 exit 0, 차이 출력 없음으로 통과했다. 실행 파일은 ELF machine 62(x86_64)로 별도 확인했다. Paseo 본체·런처·플러그인·upstream 소스 패치가 없다.

### 사용 중인 환경

- 최종 Space: **`local:paseo-x64-ubuntu`**, 이름 `paseo-x64-ubuntu`. 작업 후 삭제하지 않았으며 데스크톱과 독립 데몬이 실행 중이다.
- guest: Ubuntu 24.04.5 LTS, kernel `6.8.0-146-generic`, `uname -m = x86_64`, Cua arch `amd64`, spacesd 0.5.3, Xfce/Thunar, `DISPLAY=:1`.
- host: Mac ARM64. 새로 설치한 QEMU 11.1.2가 `qemu-system-x86_64`로 실행된다. `q35,smm=off`, CPU `max`, `tcg,thread=multi,tb-size=1024`, vCPU 2, RAM 4096MB. ARM64 Linux 안의 x64 프로세스 변환이 아니라 x64 Linux 전체를 에뮬레이션한다.
- 이미지: `ghcr.io/trycua/linux@sha256:ce7fc24fd255ed4e8ed3fe60d5a998ce33584f545b3a165b36567d30cc6c823e`. Cua 공식 `24.04-disk` 목록의 **amd64 manifest**를 지정하여 host ARM64 자동 선택을 피했다.
- 데스크톱·데몬: **Paseo 0.12.0**. 출처는 공식 `Paseo-0.12.0-amd64.deb` 한 개이며, 독립 데몬은 패키지에 포함된 CLI로 데스크톱보다 먼저 시작했다. Electron 44.2.0, bundled Node 24.20.0, guest 시스템 Node 24.21.0.
- 패키지 SHA-256: `3bb741849b961d251eb107984c894b4dd01348a59343e9d7b105b9eb22e0f76e`.
- 독립 데몬 home `/home/cua/.paseo-x64-test`, listen `127.0.0.1:6779`, relay disabled, server ID `srv_LFhfpfHpRRq0`. `desktopManaged: false`. 검증 당시 supervisor PID 969, worker PID 982.
- 데스크톱 상태 폴더 `/home/cua/.config/Paseo-x64-test`. 첫 GUI PID 1100, 재실행 GUI PID 2475. PID는 다음 실행에서 달라질 수 있다.
- 합성 guest workspace `wks_c699c9019ee02801`, 경로 `/home/cua/paseo-drop-test`, 터미널 `b57d06dc-5c50-40f9-a202-08416b03edde`.
- 인수 에이전트 `05c18ac5-3930-4568-b4a0-51fc9bd56b4e`, host workspace `wks_1fa1a85bc684e408`. 원래 부모 에이전트는 `370ee446-7ed8-4a38-b5df-6a660e63db0c`.

### 실제 검증 결과

1. Cua로 x64 VM을 생성하고 guest에서 `uname`, OS, 실제 디스크 정보를 확인했다. 기존 ARM64 Space `local:space-2653f07b52`는 Cua MCP·CLI 접속에서 timeout이 발생했으므로 대체 환경을 만들었으며, 기존 Space는 삭제하지 않았다.
2. 공식 amd64 `.deb` 설치 exit 0. 실제 Electron Paseo 창과 워크스페이스·터미널이 렌더링됐다. CLI 버전이나 splash 화면만으로 완료 처리하지 않았다.
3. `daemon status --json`은 `running`, `connectedDaemon: reachable`, `desktopManaged: false`, `daemonVersion: 0.12.0`을 반환했다. `/api/health`는 `status: ok`. 데스크톱 로그가 같은 server ID/listen을 확인했고, `ss`에서 데스크톱 네트워크 프로세스와 데몬 사이의 loopback 연결도 확인했다.
4. Thunar의 26-byte `sample.csv`를 Paseo 내장 터미널로 **실제 OS 드래그**했다. 화면과 `paseo terminal capture` 양쪽에서 `'/home/cua/paseo-drop-test/sample.csv'`가 입력줄에 삽입된 것을 확인했다. Enter는 누르지 않았다. 파일 SHA-256은 드롭 전후 `e7a3929e0913e80f475f937db1615bfa29484299e93ea55d8c87e92770c8078d`로 동일하다. CSV 플러그인은 만들거나 검증하지 않았다.
5. 테스트 데스크톱 PID 1100을 종료한 뒤에도 독립 데몬 supervisor PID 969가 유지됐다. 데스크톱을 재실행하자 같은 데몬·워크스페이스·터미널에 다시 연결됐다. 최종 assert 검증이 모두 통과했다.
6. teleport, 사용자 로그인·프로필·인증 정보 복사, 모델 로그인은 사용하지 않았다. 호스트 Paseo 앱·데몬의 설치/리로드/재시작이나 전역 Codex/Paseo 설정 변경을 하지 않았다. 호스트의 새 설치는 요청한 x64 Linux 실행을 위한 QEMU 및 Homebrew 의존성이다.
7. 저장소에는 이 문서와 검증 증거만 추가했다. 임의 커밋·기능 worktree 생성·CSV 기능 구현은 하지 않았으며 `CLAUDE.md -> AGENTS.md` 상대 링크를 유지했다.

### 반복 실행 절차

Mac에서 최초 한 번, Cua 지원 QEMU 런타임과 amd64 VM을 준비한다. 이미지 digest는 amd64를 지정한다. 이미 같은 Space가 있다면 다시 생성하지 않고 Cua `start_space`를 사용한다.

```sh
cua runtime setup qemu
cua sb create ghcr.io/trycua/linux@sha256:ce7fc24fd255ed4e8ed3fe60d5a998ce33584f545b3a165b36567d30cc6c823e \
  --on local --kind vm --runtime qemu --name paseo-x64-ubuntu
```

아래는 **Space 안에서** Cua `space_bash`로 실행하는 명령이다. 설치한 환경에서는 다운로드·설치를 반복할 필요가 없다.

```sh
uname -m # x86_64
curl -fL --retry 2 \
  https://github.com/getpaseo/paseo/releases/download/v0.12.0/Paseo-0.12.0-amd64.deb \
  -o /home/cua/Paseo-0.12.0-amd64.deb
echo '3bb741849b961d251eb107984c894b4dd01348a59343e9d7b105b9eb22e0f76e  /home/cua/Paseo-0.12.0-amd64.deb' | sha256sum -c -
sudo apt-get install -y /home/cua/Paseo-0.12.0-amd64.deb
mkdir -p /home/cua/.paseo-x64-test /home/cua/paseo-evidence
cat > /home/cua/.paseo-x64-test/config.json <<'JSON'
{"daemon":{"listen":"127.0.0.1:6779","relay":{"enabled":false}}}
JSON
/opt/Paseo/resources/bin/paseo daemon start --home /home/cua/.paseo-x64-test --timeout 90
/opt/Paseo/resources/bin/paseo daemon status --home /home/cua/.paseo-x64-test --json
curl -fsS http://127.0.0.1:6779/api/health
nohup env PASEO_HOME=/home/cua/.paseo-x64-test \
  PASEO_ELECTRON_USER_DATA_DIR=/home/cua/.config/Paseo-x64-test \
  PASEO_RELAY_ENABLED=false /opt/Paseo/Paseo \
  > /home/cua/paseo-evidence/desktop-launch.log 2>&1 < /dev/null &
```

같은 시작 설정은 guest `/home/cua/paseo-evidence/run-desktop.sh`와 로컬 증거의 `paseo-export/run-desktop.sh`에 있다.

GUI 검증은 Cua `list_tools`로 guest 스키마를 확인하고, `call_tool`의 `list_windows` / `get_desktop_state` / `click` / `drag`를 사용했다. Electron background click이 명시적으로 거부되어 허용된 Space의 foreground / desktop 입력으로 전환했다. 창 이미지의 갱신이 늦게 보이는 경우가 있어 최종 확인은 전체 데스크톱 이미지로 수행했다.

스크린샷은 `get_desktop_state(screenshot_out_file="/home/cua/paseo-evidence/<name>.png")`로 저장하고 Cua `download`로 로컬 증거 폴더에 가져온다. 로그는 guest daemon home의 `daemon.log`와 `paseo-evidence/desktop-*.log`에 있다. 공유할 사본은 token/password/secret/credential/pairing URL이 포함된 줄을 제거한 redacted 로그를 사용한다. 상태 디렉터리 자체는 인증 자료를 포함할 수 있으므로 복사하지 않는다.

### 증거 위치

저장소 기준 **`docs/handoffs/evidence/ubuntu-paseo-x64/`**:

- `desktop-drop-verified.png`: Thunar의 합성 CSV와 Paseo 터미널에 삽입된 실제 경로.
- `desktop-relaunch-verified.png`: 데스크톱 재실행 후 같은 워크스페이스·터미널 복구.
- `image-catalog.json`, `qemu-runtime.json`, `qemu-setup.log`, `paseo-release.json`: VM/CPU/배포 출처.
- `paseo-export/environment.txt`, `electron-runtime.json`, `elf-architecture.json`, `binary-and-connection.txt`: guest·버전·아키텍처·프로세스 연결.
- `paseo-export/install.log`, `install.exit`, `package-verify.txt`, `package-verify.exit`: 설치와 원본 패키지 무변경 검증. 빈 `package-verify.txt`는 차이 없음이다.
- `paseo-export/daemon-status.json`, `daemon-after-desktop-quit.json`, `health.json`: 첫 실행과 독립 데몬 생존.
- `paseo-export/terminal-after-drop.json`, `workspace.json`, `terminal.json`, `sample.csv`: 드롭의 의미적 readback과 fixture.
- `final-verification/verification.json`, `daemon-after-relaunch.json`, `health.json`, `relaunch-connection.txt`: 재실행 뒤 최종 assert·health·연결 검증.
- `paseo-export/*.redacted.log`, `final-verification/*.redacted.log`: launch/daemon 로그. 최종 로그는 `final-verification/`에 있다.
- `arm64-abandoned-environment.txt`: 삭제한 초기 ARM64 시도의 기록이며 최종 x64 검증과 구분한다.
- guest 원본 증거는 `/home/cua/paseo-evidence`, 공유용 사본은 `/home/cua/paseo-export`, `/home/cua/final-verification`에 있다. Cua download의 파일·폴더 SHA-256 검증을 통과했다.

### 실제 시도·남은 한계

- 기존 Space의 `space_bash`/driver timeout 및 시작 후 재접속 실패를 확인했다. 기존 Space의 내부 상태를 성공으로 추정하지 않았다.
- `--disable-gpu`를 앱의 명령행 인수로 전달한 첫 실행은 Paseo CLI passthrough의 `unknown option`으로 종료됐다. 인수를 제거하고 공식 앱을 그대로 실행하여 해결했다. 소스/바이너리 수정이나 sandbox 비활성화는 없었다. 앱 로그는 user namespace sandbox가 활성화됐음을 확인한다.
- QEMU TCG라 native 실행보다 느리며, 초기 UI가 늦게 뜬다. WebGL2 blocklist 로그가 있지만 검증한 터미널·파일 드롭은 정상 동작했다. GPU/브라우저/음성 기능의 성능 보장은 하지 않는다.
- 실제 VM 디스크는 20GB, 최종 `df`는 약 14GB available이다. host 최종 `df`는 약 31GiB available이다. 합성 26-byte CSV만 사용했으며 **5GB 데이터·임시 디스크 피크·전체 검색/정렬 성능은 검증하지 않았다**.
- 모델 provider는 설치·인증하지 않았다. CSV 플러그인, 기능 bootstrap/worktree, macOS/Windows 앱 호환성은 이번 범위에 없다. 이 결과로 #2 전체나 후속 기능 이슈를 닫지 않는다.
- 진행 대시보드 CLI는 플러그인 미설치/연결 불가를 반환했다. 호스트 플러그인을 설치하지 않고 채팅·문서·증거 파일로 진행을 기록했다.

공식 근거: [Paseo v0.12.0](https://github.com/getpaseo/paseo/releases/tag/v0.12.0), [Cua 이미지 목록](https://cua.ai/docs/cua-sdk/reference/os-image-catalog), [Paseo Linux 문제 해결](https://paseo.sh/docs/troubleshooting.md).

추적 기록: [이슈 #2 결과 댓글](https://github.com/hoon0422/csv-viewer/issues/2#issuecomment-6306486757). 이슈는 닫지 않았다.

부모 에이전트 `370ee446-7ed8-4a38-b5df-6a660e63db0c`에 Paseo 도구로 완료 결과·증거 경로·범위 제한을 전달했으며 전송 성공을 확인했다.
