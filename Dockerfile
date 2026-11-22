FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY agent.config.js booth.js server.js ./
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
