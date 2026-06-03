# ============================================================
# build stage — npm install + sherpa-onnx-node native build
# ============================================================
FROM node:20-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm prune --production

# ============================================================
# run stage — minimal image
# ============================================================
FROM node:20-slim AS run

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/telepi.sh ./

ENV NODE_ENV=production
ENV SHERPA_ONNX_NUM_THREADS=2

CMD ["node", "dist/index.js"]
