# 📸 영수증 자동 가계부

영수증을 촬영하면 자동으로 구글 시트 가계부에 기록되는 시스템 구축 가이드입니다.

## 📸 미리보기

<div align="center">
  <img src="https://github.com/user-attachments/assets/76c51fd5-ee83-4a35-92eb-1b67e859fe4d" alt="영수증 업로드 화면" width="400"/>
  <img src="https://github.com/user-attachments/assets/93b2dabc-376e-41f6-a70b-b021c2d74a1b" alt="구글 시트 자동 기록" width="400"/>
</div>

<div align="center">
  <p><em>영수증 업로드 화면</em> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <em>구글 시트 자동 기록</em></p>
</div>

---

## 📋 목차

1. [시스템 개요](#시스템-개요)
2. [사전 준비물](#사전-준비물)
3. [Google Cloud 설정](#google-cloud-설정)
4. [구글 시트 준비](#구글-시트-준비)
5. [로컬 개발 환경 설정](#로컬-개발-환경-설정)
6. [프로젝트 파일 생성](#프로젝트-파일-생성)
7. [로컬 테스트](#로컬-테스트)
8. [GitHub 업로드](#github-업로드)
9. [Vercel 배포](#vercel-배포)
10. [도메인 연결](#도메인-연결)
11. [문제 해결](#문제-해결)

---

## 🎯 시스템 개요

### 작동 방식
```
영수증 사진 촬영/업로드
    ↓
Google Vision API (OCR)
    ↓
AI가 정보 추출 (날짜, 상호, 금액, 카테고리)
    ↓
구글 시트에 자동 기록
```

### 기술 스택
- **프론트엔드**: HTML, JavaScript
- **백엔드**: Node.js (Vercel Serverless Functions)
- **OCR**: Google Vision API
- **데이터 저장**: Google Sheets API
- **호스팅**: Vercel (무료)

### 비용
- **완전 무료**: Google Vision API 월 1,000건 무료
- **Vercel**: 무료 플랜 (100GB 대역폭/월)
- **추가 비용**: 없음 (무료 범위 내 사용 시)

---

## 📦 사전 준비물

### 필수 항목
- [ ] Google 계정
- [ ] GitHub 계정
- [ ] Vercel 계정
- [ ] 도메인 (선택사항)

### 소프트웨어
- [ ] Node.js 18 이상
- [ ] Git

### 설치 확인
```bash
# Node.js 버전 확인
node --version  # v18.0.0 이상

# npm 버전 확인
npm --version

# Git 확인
git --version
```

---

## ☁️ Google Cloud 설정

### 1단계: 프로젝트 생성

1. https://console.cloud.google.com 접속
2. 상단 프로젝트 선택 → **"새 프로젝트"**
3. 프로젝트 이름: `receipt-tracker`
4. **"만들기"** 클릭
5. 프로젝트가 생성되면 선택

### 2단계: 결제 설정 (무료 크레딧)

⚠️ **중요**: 카드 등록이 필요하지만 무료 범위 내에서는 과금되지 않습니다.

1. 좌측 메뉴 → **"결제(Billing)"**
2. **"결제 계정 연결"** 클릭
3. 카드 정보 입력
4. **무료 크레딧 $300** 자동 제공 (3개월)

### 3단계: API 활성화

#### Cloud Vision API
1. 좌측 메뉴 → **"API 및 서비스"** → **"라이브러리"**
2. 검색: `Cloud Vision API`
3. **"사용 설정"** 클릭

#### Google Sheets API
1. 같은 방법으로 검색: `Google Sheets API`
2. **"사용 설정"** 클릭

### 4단계: 서비스 계정 생성

1. 좌측 메뉴 → **"IAM 및 관리자"** → **"서비스 계정"**
2. **"+ 서비스 계정 만들기"** 클릭
3. 정보 입력:
   ```
   서비스 계정 이름: receipt-service
   서비스 계정 ID: receipt-service (자동)
   설명: 영수증 자동 가계부용
   ```
4. **"만들고 계속하기"**
5. 역할 선택: **"편집자"** 선택
6. **"계속"** → **"완료"**

### 5단계: JSON 키 생성

1. 생성된 서비스 계정 클릭
2. 상단 **"키"** 탭
3. **"키 추가"** → **"새 키 만들기"**
4. 유형: **JSON** 선택
5. **"만들기"** 클릭
6. **JSON 파일 자동 다운로드** 📥

⚠️ **보안 경고**: 이 파일은 절대 공개하지 마세요!

다운로드된 파일 예시:
```json
{
  "type": "service_account",
  "project_id": "receipt-tracker-123456",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...",
  "client_email": "receipt-service@receipt-tracker-123456.iam.gserviceaccount.com",
  ...
}
```

---

## 📊 구글 시트 준비

### 1단계: 새 스프레드시트 생성

1. https://sheets.google.com 접속
2. **"빈 스프레드시트"** 만들기
3. 이름: **"가계부"** (또는 원하는 이름)

### 2단계: 헤더 설정

첫 번째 행(A1~E1)에 입력:

| A1 | B1 | C1 | D1 | E1 |
|----|----|----|----|----|
| 날짜 | 상호 | 금액 | 카테고리 | 결제수단 |

### 3단계: 서비스 계정 공유

1. 우측 상단 **"공유"** 버튼 클릭
2. 다운로드한 JSON 파일에서 `client_email` 복사
   - 예: `receipt-service@receipt-tracker-123456.iam.gserviceaccount.com`
3. 이 이메일을 **편집자**로 추가
4. **"완료"** 클릭

### 4단계: 시트 ID 복사

URL에서 시트 ID 복사:
```
https://docs.google.com/spreadsheets/d/{1a2b3c4d5e6f7g8h9i0j}/edit
                                           ↑ {} 이 부분이 시트 ID
```

시트 ID를 메모장에 저장해두세요!

---

## 💻 로컬 개발 환경 설정

### 1단계: 프로젝트 폴더 생성

```bash
# 원하는 위치로 이동
cd ~/Desktop

# 프로젝트 폴더 생성
mkdir receipt-tracker
cd receipt-tracker
```

### 2단계: Node.js 패키지 초기화

```bash
# package.json 생성
npm init -y
```

### 3단계: 필요한 패키지 설치

```bash
npm install @google-cloud/vision googleapis formidable
```

### 4단계: Vercel CLI 설치

```bash
# 글로벌 설치
npm install -g vercel
```

설치 확인:
```bash
vercel --version
```

---

## 📁 프로젝트 파일 생성

### 폴더 구조

```
receipt-tracker/
├── .env                    # 환경변수 (Git 제외!)
├── .gitignore             # Git 제외 목록
├── index.html             # 업로드 페이지
├── package.json           # 패키지 설정
├── vercel.json            # Vercel 설정
└── api/
    └── analyze.js         # 백엔드 API
```

### 1. .gitignore 생성

```bash
cat > .gitignore << 'EOF'
.env
node_modules/
.vercel
*.log
EOF
```

### 2. .env 파일 생성

```bash
touch .env
```

`.env` 파일 내용 (텍스트 에디터로 편집):
```env
GOOGLE_SHEETS_ID=여기에_시트ID_입력
GOOGLE_SERVICE_ACCOUNT=여기에_JSON_전체내용_입력
```

**GOOGLE_SHEETS_ID**: 
- 구글 시트 URL에서 복사한 ID

**GOOGLE_SERVICE_ACCOUNT**:
- 다운로드한 JSON 파일 전체 내용을 복사-붙여넣기
- JSON 값을 한 줄로 변환하여 붙여넣으면 됩니다

### 3. package.json 수정

```json
{
  "name": "receipt-tracker",
  "version": "1.0.0",
  "description": "영수증 자동 가계부",
  "main": "index.html",
  "dependencies": {
    "@google-cloud/vision": "^4.0.0",
    "googleapis": "^128.0.0",
    "formidable": "^3.5.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### 4. vercel.json 생성

```json
{
  "functions": {
    "api/analyze.js": {
      "maxDuration": 30,
      "memory": 1024
    }
  }
}
```

### 5. api 폴더 생성

```bash
mkdir api
```

### 6. 파일 다운로드

프론트엔드(`index.html`)와 백엔드(`api/analyze.js`) 코드는 
위의 아티팩트에서 복사하여 각각의 파일에 붙여넣으세요.

---

## 🧪 로컬 테스트

### 1단계: 환경변수 확인

```bash
# .env 파일이 제대로 설정되었는지 확인
cat .env
```

다음 두 값이 있어야 합니다:
- `GOOGLE_SHEETS_ID`
- `GOOGLE_SERVICE_ACCOUNT`

### 2단계: 로컬 서버 실행

```bash
vercel dev
```

성공 시 출력:
```
Vercel CLI 49.1.2
> Ready! Available at http://localhost:3000
```

### 3단계: 브라우저 테스트

1. 브라우저에서 http://localhost:3000 접속
2. 영수증 사진 업로드
3. "분석 및 기록하기" 버튼 클릭
4. 구글 시트 확인

### 4단계: 로그 확인

터미널에서 다음과 같은 로그 확인:
```
Files received: [ 'receipt' ]
Receipt file: /var/folders/.../xxx.jpg
Vision API response received
Detected text length: 367
날짜 찾음: 2024-12-10
상호 찾음: 이마트 탄현점
금액 찾음: 27600
Successfully added to sheet
```

---

## 🚀 GitHub 업로드

### 1단계: Git 초기화

```bash
# Git 저장소 초기화
git init

# 파일 추가 (.gitignore가 .env를 자동 제외)
git add .

# 첫 커밋
git commit -m "Initial commit: 영수증 자동 가계부"
```

### 2단계: GitHub 저장소 생성

1. https://github.com 접속
2. 우측 상단 **"+"** → **"New repository"**
3. Repository name: `receipt-tracker`
4. Public 또는 Private 선택
5. **"Create repository"** 클릭

### 3단계: 원격 저장소 연결 및 푸시

```bash
# 원격 저장소 추가
git remote add origin https://github.com/your-username/receipt-tracker.git

# main 브랜치로 변경
git branch -M main

# 푸시
git push -u origin main
```

✅ GitHub에서 파일이 올라갔는지 확인!

⚠️ **확인**: `.env` 파일이 **없어야** 합니다! (보안)

---

## ☁️ Vercel 배포

### 1단계: Vercel 로그인

1. https://vercel.com 접속
2. **"Sign Up"**

또는 터미널:
```bash
vercel login
```

### 2단계: 프로젝트 Import

#### 웹 대시보드 방식 (추천)

1. Vercel 대시보드 → **"Add New"** → **"Project"**
2. GitHub 저장소 찾기: `receipt-tracker`
3. **"Import"** 클릭
4. Framework Preset: **Other** (자동 선택됨)
5. **환경변수 설정하지 말고** 일단 **"Deploy"** 클릭
6. 배포 실패해도 OK (환경변수 설정 후 재배포)

#### CLI 방식

```bash
vercel
```

질문에 답변:
```
? Set up and deploy? Y
? Which scope? (본인 계정 선택)
? Link to existing project? N
? Project name? receipt-tracker
? In which directory is your code located? ./
```

### 3단계: 환경변수 설정 ⭐ 중요!

#### 웹 대시보드에서

1. Vercel 프로젝트 → **"Settings"** → **"Environment Variables"**
2. **"Add New"** 클릭

**첫 번째 환경변수:**
```
Name: GOOGLE_SHEETS_ID
Value: 1a2b3c4d5e6f7g8h9i0j... (시트 ID)
Environments: ✅ Production, ✅ Preview, ✅ Development
```

**두 번째 환경변수:**
```
Name: GOOGLE_SERVICE_ACCOUNT
Value: {"type":"service_account",...전체JSON...}
Environments: ✅ Production, ✅ Preview, ✅ Development
```

⚠️ **주의**: JSON 전체를 복사-붙여넣기

#### CLI 방식

```bash
vercel env add GOOGLE_SHEETS_ID production
# 시트 ID 입력

vercel env add GOOGLE_SERVICE_ACCOUNT production
# JSON 전체 붙여넣기
```

### 4단계: 재배포

```bash
vercel --prod
```

또는 웹에서:
1. **Deployments** 탭
2. 최신 배포의 **"..."** → **"Redeploy"**

### 5단계: 배포 확인

성공 시:
```
✓ Production: https://receipt-tracker-xxx.vercel.app [복사됨]
```

이 URL로 접속하여 테스트!

---

## 🌐 도메인 연결 (선택사항)

### Vercel에서 설정

1. 프로젝트 → **"Settings"** → **"Domains"**
2. **"Add"** 버튼 클릭
3. 본인 도메인 입력:
   - `receipt.yourdomain.com` (서브도메인)
   - 또는 `yourdomain.com` (루트 도메인)
4. **"Add"** 클릭

### DNS 설정

Vercel이 제공하는 DNS 레코드를 도메인 관리 페이지에 추가:

**CNAME 레코드** (서브도메인):
```
Type: CNAME
Name: receipt
Value: cname.vercel-dns.com
TTL: 3600
```

**A 레코드** (루트 도메인):
```
Type: A
Name: @
Value: 76.76.21.21
TTL: 3600
```

### 전파 대기

- DNS 전파: 5분 ~ 1시간
- Vercel에서 자동으로 SSL 인증서 발급
- 완료되면 https://receipt.yourdomain.com 접속 가능!

---

## 🐛 문제 해결

### 로컬 테스트 오류

#### Error: Cannot find module 'googleapis'
```bash
npm install
```

#### Error: ENOENT package.json
```bash
# package.json이 있는지 확인
ls -la

# 없으면 다시 생성
npm init -y
```

#### vercel dev가 자기 자신을 호출
```bash
# package.json에서 "dev" 스크립트 제거
# 직접 vercel dev 명령어 사용
```

### Vision API 오류

#### Error: PERMISSION_DENIED
- Google Cloud Console에서 결제 정보 입력
- Vision API가 활성화되었는지 확인
- 5-10분 대기 후 재시도

#### Error: API not enabled
- Cloud Vision API 활성화 확인
- 프로젝트가 올바르게 선택되었는지 확인

### Sheets API 오류

#### Error: Permission denied
- 구글 시트에 서비스 계정 이메일 공유했는지 확인
- 권한: **편집자**로 설정

#### Error: Spreadsheet not found
- `GOOGLE_SHEETS_ID`가 올바른지 확인
- 시트 ID는 URL의 `/d/`와 `/edit` 사이 부분

### Vercel 배포 오류

#### Cannot find module in production
1. `package.json`의 `dependencies` 확인
2. GitHub에 푸시되었는지 확인
3. Vercel에서 재배포

#### Environment variable not found
1. Vercel 대시보드 → Settings → Environment Variables
2. 변수가 **Production** 환경에 설정되었는지 확인
3. 재배포

### 금액/날짜/상호 인식 오류

#### 금액이 0원
- 로그에서 "금액 찾음" 메시지 확인
- OCR 텍스트에 "합계", "총액" 키워드가 있는지 확인
- 영수증 사진 품질 확인 (선명하게 촬영)

#### 날짜가 이상함
- "거래일시" 키워드 근처 확인
- 날짜 형식이 YYYY-MM-DD, YYYY.MM.DD 등인지 확인

#### 상호가 잘못됨
- "가맹점:", "상호:" 키워드 확인
- 로그의 "파싱할 줄 목록" 확인
- 필요시 `analyze.js`의 상호 파싱 로직 수정

---

## 📈 다음 단계 개선 아이디어

### 기능 추가

1. **수정 기능**: 웹에서 직접 수정 가능
2. **통계 대시보드**: 월별 지출 그래프
3. **카테고리 학습**: AI가 상호명 학습
4. **중복 체크**: 같은 영수증 두 번 입력 방지
5. **알림 기능**: 월 예산 초과 시 이메일

### PWA 변환

모바일 앱처럼 사용하기:
- manifest.json 추가
- Service Worker 등록
- 홈 화면에 추가 가능

### 인식 정확도 향상

- 더 많은 영수증 형식 학습
- 카테고리 자동 학습
- 상호명 데이터베이스 구축

---

## 📚 참고 자료

- [Google Cloud Vision API](https://cloud.google.com/vision/docs)
- [Google Sheets API](https://developers.google.com/sheets/api)
- [Vercel 문서](https://vercel.com/docs)
- [Node.js formidable](https://github.com/node-formidable/formidable)

**🎉 축하합니다! 영수증 자동 가계부를 성공적으로 구축하셨습니다!**

이제 영수증을 촬영만 하면 자동으로 가계부에 기록됩니다. 💰📊
