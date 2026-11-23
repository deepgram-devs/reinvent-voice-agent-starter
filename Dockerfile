FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY agent.config.js backend.js booth.js server.js ./
COPY public ./public
ENV PORT=8080
USER node
EXPOSE 8080
CMD ["node", "server.js"]
