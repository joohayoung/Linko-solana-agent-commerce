# Linko 서버 — Cloud Run 배포용.
# Cloud Run이 PORT 환경변수를 주입하면 server.mjs(src/config.mjs)가 그대로 읽어서 그 포트로
# 리슨하고(APP_PORT = process.env.PORT || 3000), TLS는 Cloud Run 엣지에서 종료되므로
# 컨테이너 안에서는 항상 plain HTTP로 충분하다 — certs/ 폴더를 이미지에 넣지 않으면 자동으로
# HTTP 모드로 뜬다(server.mjs의 기존 fallback 로직 그대로).
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.mjs ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 8080

CMD ["./docker-entrypoint.sh"]
