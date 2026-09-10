# --- build ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 배포 환경에서는 nginx가 /api를 백엔드로 프록시하는 동일 출처(same-origin) 구조라
# 프론트가 절대경로가 아닌 상대경로(/api/...)로 호출하도록 빈 값을 기본값으로 둔다.
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# --- serve ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
