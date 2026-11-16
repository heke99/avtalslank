FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends qpdf ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages ./packages
COPY apps/worker ./apps/worker
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--import", "tsx", "apps/worker/index.ts"]
