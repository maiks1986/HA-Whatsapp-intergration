# Stage 1: Build Frontend
FROM node:20-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts ./
COPY frontend/index.html ./
COPY frontend/src ./src
RUN npm install && npm run build

# Stage 2: Build Backend & Serve
FROM node:20-alpine
RUN apk add --no-cache python3 make g++ git

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

# Copy built frontend assets to backend dist/public
COPY --from=build-frontend /app/dist/public ./dist/public

EXPOSE 5002
CMD ["npm", "start"]
