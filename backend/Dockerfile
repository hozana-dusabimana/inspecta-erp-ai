# INSPECTA BUILDOS — backend image
FROM node:20-alpine

# Prisma needs OpenSSL on Alpine (and libc6-compat for the query engine).
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Install deps (cached layer)
COPY package.json package-lock.json* ./
RUN npm install

# Prisma needs the schema before generate
COPY prisma ./prisma
RUN npx prisma generate

# App source
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

EXPOSE 4000

# On container start: apply schema, seed, then run the compiled server.
CMD ["sh", "-c", "npx prisma db push && npx tsx prisma/seed.ts && node dist/index.js"]
