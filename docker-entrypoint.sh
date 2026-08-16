#!/bin/sh
# Cloud Run은 서로 다른 시크릿을 같은 디렉토리에 파일로 동시 마운트할 수 없어서,
# 지갑 시크릿들을 /secrets/<name>/<file>.json 형태로 각자 다른 디렉토리에 마운트하고
# 여기서 WALLETS_DIR(/app/wallets)로 모아준 뒤 서버를 기동한다.
#
# Cloud Run의 시크릿 볼륨은 K8s와 같은 심볼릭 링크 원자적 교체 방식이라, cp가 복사 도중
# 소스가 바뀌었다고 경고하며 0이 아닌 종료 코드를 낼 수 있다(실제 파일은 정상 복사됨) —
# 그래서 이 루프에서는 set -e를 적용하지 않고 cat으로 안전하게 읽어서 쓴다.
mkdir -p /app/wallets
for f in /secrets/*/*.json; do
  if [ -f "$f" ]; then
    cat "$f" > "/app/wallets/$(basename "$f")"
  fi
done
exec node server.mjs
