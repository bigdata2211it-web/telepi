FROM node:20-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm prune --production

FROM node:20-slim AS run

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/telepi.sh ./

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
