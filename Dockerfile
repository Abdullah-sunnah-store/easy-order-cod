FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Install EVERYTHING first: `remix vite:build` needs vite, which is a
# devDependency. Setting NODE_ENV=production here (or using --omit=dev) makes
# npm skip it and the build fails with "vite: not found".
COPY package.json package-lock.json* ./
RUN npm ci --include=dev && npm cache clean --force

COPY . .
RUN npm run build

# Drop the build-only packages now that the bundle exists. The `prisma` CLI
# stays — it is a dependency and `npm run setup` runs migrations at boot.
RUN npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "docker-start"]
