FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
ENV WEBHOOK_PORT=3000

EXPOSE 3000

USER node

CMD ["node", "src/index.js"]
