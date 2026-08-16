#!/usr/bin/env bash
# Linko를 GCP Cloud Run에 배포하는 스크립트. 직접 실행해야 합니다 — gcloud 인증은
# 본인 구글 계정 브라우저 로그인이 필요해서 에이전트가 대신 할 수 없습니다.
#
# 사전 준비:
#   1. gcloud CLI 설치: https://cloud.google.com/sdk/docs/install
#   2. gcloud auth login
#   3. 아래 PROJECT_ID가 실제 프로젝트와 맞는지 확인 (.env의 GOOGLE_CLOUD_PROJECT 기준으로 기본값 설정함)
#
# 실행: bash scripts/deploy-cloud-run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# ---------------- 설정값 (필요하면 수정) ----------------
PROJECT_ID="${PROJECT_ID:-eqp-agent}"          # .env의 GOOGLE_CLOUD_PROJECT와 동일해야 함
REGION="${REGION:-asia-northeast3}"            # 서울 리전
SERVICE_NAME="${SERVICE_NAME:-linko}"
SA_NAME="linko-cloud-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
GOOGLE_CLOUD_LOCATION="global"                 # Vertex AI 엔드포인트 리전 (.env와 동일하게 유지)
LINKO_ALT_ADDRESS="Es1FPwU1siBYdb7e5TMXXwPD7xMr6EQFCjqWZg72wbkf"

echo "=== 배포 대상: 프로젝트=$PROJECT_ID, 리전=$REGION, 서비스명=$SERVICE_NAME ==="
gcloud config set project "$PROJECT_ID"

# ---------------- 1) 필요한 API 활성화 ----------------
echo "--- 1) API 활성화 ---"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com

# ---------------- 2) Cloud Run 런타임 서비스 계정 생성 + IAM 역할 ----------------
echo "--- 2) 서비스 계정 준비 ---"
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="Linko Cloud Run runtime"
fi
# Vertex AI 호출(예산분배 에이전트) + Firestore 읽기/쓰기 권한.
# GOOGLE_APPLICATION_CREDENTIALS 파일은 안 씀 — 이 서비스 계정이 ADC로 자동 인식됨.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/aiplatform.user" --condition=None
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" --role="roles/datastore.user" --condition=None

# ---------------- 3) Firestore 데이터베이스 (없으면 생성) ----------------
echo "--- 3) Firestore 데이터베이스 확인 ---"
if ! gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION" --type=firestore-native
fi

# ---------------- 4) Secret Manager에 지갑/키 등록 ----------------
# wallets/*.json은 절대 이미지에 안 들어감(.dockerignore) — Cloud Run이 서로 다른 시크릿을
# 같은 디렉토리에 동시에 파일 마운트하지 못해서 각각 /secrets/<name>/ 아래 별도 디렉토리에
# 마운트하고, docker-entrypoint.sh가 기동 시 WALLETS_DIR(/app/wallets)로 모아준다.
echo "--- 4) Secret Manager 등록 ---"
create_or_update_secret() {
  local secret_name="$1"
  local file_path="$2"
  if [ ! -f "$file_path" ]; then
    echo "⚠️  $file_path 가 없어서 $secret_name 을 건너뜁니다."
    return
  fi
  if gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    gcloud secrets versions add "$secret_name" --data-file="$file_path"
  else
    gcloud secrets create "$secret_name" --data-file="$file_path"
  fi
  gcloud secrets add-iam-policy-binding "$secret_name" \
    --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor" --condition=None
}

create_or_update_secret linko-wallet-settlement wallets/settlement.json
create_or_update_secret linko-wallet-advertiser wallets/advertiser.json
create_or_update_secret linko-wallet-promoter-jisu wallets/promoter-jisu.json
create_or_update_secret linko-wallet-promoter-minsu wallets/promoter-minsu.json

if [ -f .env ]; then
  GEMINI_API_KEY_VALUE="$(grep -E '^GEMINI_API_KEY=' .env | head -1 | cut -d= -f2-)"
fi
if [ -n "${GEMINI_API_KEY_VALUE:-}" ]; then
  printf '%s' "$GEMINI_API_KEY_VALUE" > /tmp/linko-gemini-api-key.txt
  create_or_update_secret linko-gemini-api-key /tmp/linko-gemini-api-key.txt
  rm -f /tmp/linko-gemini-api-key.txt
else
  echo "⚠️  .env에서 GEMINI_API_KEY를 못 찾았습니다 — linko-gemini-api-key 시크릿을 직접 등록해주세요."
fi

# ---------------- 5) Cloud Run 배포 ----------------
# --source .  → Cloud Build가 원격에서 Dockerfile로 빌드(로컬 Docker 데몬 불필요)
# --min-instances=1 → 데모 당일 콜드스타트 방지
echo "--- 5) Cloud Run 배포 ---"
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --service-account "$SA_EMAIL" \
  --allow-unauthenticated \
  --min-instances=1 \
  --memory=512Mi \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION},LINKO_ALT_ADDRESS=${LINKO_ALT_ADDRESS}" \
  --set-secrets="/secrets/settlement/settlement.json=linko-wallet-settlement:latest,/secrets/advertiser/advertiser.json=linko-wallet-advertiser:latest,/secrets/promoter-jisu/promoter-jisu.json=linko-wallet-promoter-jisu:latest,/secrets/promoter-minsu/promoter-minsu.json=linko-wallet-promoter-minsu:latest,GEMINI_API_KEY=linko-gemini-api-key:latest"

echo "=== 배포 완료 ==="
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)'
echo ""
echo "참고: data/*.json에 있던 기존 로컬 테스트 데이터를 Firestore로 옮기려면:"
echo "  npm run migrate-firestore"
