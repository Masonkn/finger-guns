# One container serves the game page and runs the multiplayer server.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
