FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY node_modules ./node_modules
COPY . .
RUN npm run build

FROM scratch AS export
COPY --from=builder /app/dist /dist
