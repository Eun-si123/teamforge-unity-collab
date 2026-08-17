FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY LICENSE THIRD_PARTY_NOTICES.md ./

ENV TEAMFORGE_HOST=0.0.0.0
ENV TEAMFORGE_PORT=5080
EXPOSE 5080

USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const p=process.env.TEAMFORGE_PORT||'5080';const h=process.env.TEAMFORGE_HEALTH_PATH||'/health';fetch('http://127.0.0.1:'+p+h).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/index.mjs"]
