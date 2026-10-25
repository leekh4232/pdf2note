# PDF2Note 작업 지침

VS Code 확장 **PDF2Note**(`leekh.pdf2note`) 저장소입니다. PDF 페이지마다 줄노트 필기 영역과 머릿말 · 꼬릿말을 붙여 새 PDF를 만듭니다. `.ipynb` · `.md`는 형제 프로젝트 **Ipynb PDF Converter**(`/Users/leekh/ipynb-to-pdf-converter`, `leekh.ipynb-pdf-converter`)의 API `convertToPdfBytes`로 먼저 PDF로 바꿉니다. 원본 페이지는 pdf-lib의 `embedPage`로 넣으므로 원본의 텍스트가 결과에 그대로 남습니다.

응답과 문서는 한글로 씁니다. 코드, 커밋 메시지, 설정 이름은 원래 언어를 유지합니다.

## 코드를 고친 뒤에는 항상 아래 1~4를 이 순서로 합니다

### 1. CHANGELOG에 반영

- 파일: `CHANGELOG.md` (저장소 루트)
- 맨 위 `## [미배포]` 섹션에 적습니다. 없으면 버전 섹션들 위에 새로 만듭니다.
- 하위 제목은 `### 추가` · `### 변경` · `### 수정` · `### 제거` 중 해당하는 것만 씁니다.
- 한글로, 사용자가 체감하는 결과 위주로 씁니다. 바뀐 설정 이름과 기본값은 정확히 적습니다.
- **배포할 때** `## [미배포]`를 `## [x.y.z] - YYYY-MM-DD`로 바꿉니다. 버전은 현재 `package.json` 버전에 커밋 메시지의 올림 단위(`patch` · `minor` · `major`)를 적용한 값입니다.

### 2. README와 소개 페이지 갱신

기능이나 설정이 바뀌면 아래 파일을 모두 맞춥니다.

| 파일 | 내용 |
|:--|:--|
| `README.md` | Marketplace와 GitHub에 보이는 설명. 배지, 한눈에 보기 표, 레이아웃 그림, 사용 방법, 설정 표, 요구 사항 |
| `docs/index.html` | GitHub Pages 소개 페이지 https://pdf2note.hossam.kr (`docs/CNAME`). 다크 테마, 짧게 |
| `docs/assets/` | 소개 페이지 그림. README 그림의 다크 버전과 `icon.png` |
| `media/readme/*.svg` → `*.png` | README 그림 원본과 렌더링 결과 |
| `package.nls.json` · `package.nls.ko.json` | 명령 이름과 설정 설명(영어 · 한글) |

- **제거된 기능은 "제거됨"이라고 쓰지 않고 아예 언급하지 않습니다.** 문서에서 그 기능에 대한 문장, 표 행, 그림 속 글자를 지웁니다. 제거 기록은 CHANGELOG에만 남깁니다.
- 소개 페이지는 **이 확장이 무슨 일을 하는지만** 짧게 씁니다. 설정 이름 · 기본값 · 내부 동작은 README에 둡니다. 기능 카드는 짝수 개(지금 6개)를 유지합니다.
- README는 간결하게 쓰되, 설정 표에는 모든 설정의 기본값과 허용값을 빠짐없이 둡니다.
- Ipynb PDF Converter의 요구 버전이 바뀌면 README 배지 · 요구 사항, 소개 페이지 안내 문장, `media/readme/pipeline.svg`의 버전 글자를 함께 바꿉니다.
- 그림을 고칠 때는 SVG를 고친 뒤 PNG를 다시 만듭니다. README는 PNG만 참조합니다(vsce가 README 안의 SVG 이미지를 거부합니다).

```sh
rsvg-convert -z 2 media/readme/layout.svg -o media/readme/layout.png
python3 scripts/darken_svg.py media/readme/layout.svg /tmp/layout-dark.svg
rsvg-convert -z 2 /tmp/layout-dark.svg -o docs/assets/layout.png
```

- 바꾼 뒤 예전 표현이 남았는지 검색합니다 (예: 제거한 설정 이름, 옛 버전 번호).
- `docs/**`와 `media/readme/**`는 `.vscodeignore`로 VSIX에서 빠집니다. 새 문서용 폴더를 만들면 거기에도 추가합니다.

### 3. 로컬에 설치해서 테스트

```sh
npm run lint && npm run typecheck
npx vsce package --no-dependencies -o pdf2note-local.vsix
code --install-extension pdf2note-local.vsix --force
```

- 설치 뒤 VS Code에서 **Developer: Reload Window**를 실행해야 새 버전이 적용됩니다.
- `.vsix`는 `.gitignore`에 있어 커밋되지 않습니다.
- 바뀐 기능을 실제로 돌려 봅니다. 최소한 아래를 확인합니다.
  - 가로 원본 PDF와 세로 원본 PDF에 필기 영역이 맞게 붙는다.
  - `.ipynb` · `.md` 입력이 변환되고, 결과 PDF에서 글자를 복사 · 검색할 수 있다.
  - 비밀번호 명령으로 만든 PDF가 그 비밀번호로만 열린다. 비밀번호가 걸린 원본도 열린다.
  - 피드백 모드(`layoutMode: feedback`)에서 배너와 분리선이 나온다 (레이아웃을 건드렸다면 필수).
- 직접 클릭할 수 없을 때는 `@vscode/test-electron`으로 별도 VS Code를 내려받아, `extensionDevelopmentPath`에 이 저장소와 Ipynb PDF Converter 저장소를 함께 넣고 `pdf2note.addNotes` 명령을 파일 URI로 실행합니다. 결과 PDF는 PyMuPDF(`fitz`)로 `page.get_text()`와 `page.search_for()`로 확인합니다. 이때 함정이 세 가지 있습니다.
  - VS Code 터미널에서 실행하면 `ELECTRON_RUN_AS_NODE`가 설정돼 있어 Node로 뜹니다. `env -u ELECTRON_RUN_AS_NODE`로 실행합니다.
  - 최신 VS Code는 실행 파일이 `Contents/MacOS/Code`라서 `vscodeExecutablePath`를 직접 지정해야 합니다.
  - `--user-data-dir` 경로가 길면 소켓 경로 제한(macOS 104자)에 걸립니다. 짧은 경로를 씁니다.
- 테스트에 실패하면 고치고 1~3을 다시 합니다. 실패한 상태로 push하지 않습니다.

### 4. 테스트에 성공하면 push

```sh
git add -A && git commit -m "<type>: <요약>" && git push origin main
```

- 커밋 메시지는 영어 Conventional Commits 형식(`feat:` · `fix:` · `docs:` · `chore:`)을 씁니다.
- **`main`에 push한 커밋 메시지에 `build`가 들어가면 Marketplace 배포가 시작됩니다** (`.github/workflows/build-and-publish.yml`). `rebuild` 같은 단어에도 걸리니, 배포하지 않을 때는 이 글자를 넣지 않습니다.
- 배포는 사용자가 요청할 때만 합니다. 그때 메시지에 `build`와 올림 단위를 함께 씁니다. 예: `feat: text layer (minor build)`. 단위가 없으면 `patch`입니다.
- Ipynb PDF Converter의 새 기능에 기대는 변경이면, **변환기를 먼저 배포**하고 Marketplace에 보인 뒤 PDF2Note를 배포합니다.
- 워크플로가 버전을 올려 `chore: release vX.Y.Z [skip ci]` 커밋과 태그를 push합니다. 다음 작업 전에 `git pull`합니다.
- 배포 후 Marketplace에 새 버전이 보이는지 확인합니다. 반영까지 몇 분 걸립니다.

## 참고

- 빌드: `npm run build`(esbuild로 `out/extension.js` 하나로 묶음). `vscode:prepublish`가 타입 검사와 함께 실행합니다.
- 머릿말 · 꼬릿말 한글 글꼴은 `media/fonts/NanumGothic.ttf`(SIL OFL, `media/fonts/NanumGothic-OFL.md`)입니다. PDF에는 쓰인 글자만 들어갑니다.
- 배치 규칙과 크기 상수는 `src/note.ts`, 명령 · 설정 · 변환기 호출은 `src/extension.ts`에 있습니다.
