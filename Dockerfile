FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN node scripts/build.js
USER node
ENV PORT=3001
EXPOSE 3001
CMD ["node","server.js"]
