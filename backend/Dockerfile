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

# On container start: apply migrations (auto-baselining a pre-existing DB on the
# first run), seed, then run the compiled server. See prisma/start.sh.
CMD ["sh", "prisma/start.sh"]
