# ── IBM Cloud Code Engine deployment ─────────────────────────────────────────
# WHY CODE ENGINE: IBM Cloud Code Engine is a fully managed serverless container
# platform. You push a Docker image, Code Engine handles scaling (including
# scale-to-zero when idle), HTTPS, and load balancing. No infrastructure to
# manage — perfect for a fitness app that may see spikes around race season.
#
# Build:  docker build -t hybrid-training-ibm .
# Run:    docker run -p 3000:3000 --env-file .env.local hybrid-training-ibm

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build without lint to keep image build fast
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
