FROM node:18-alpine AS builder

WORKDIR /app

# Accept build args for Next.js public environment variables
ARG NEXT_PUBLIC_SPOTIFY_CLIENT_ID
ARG NEXT_PUBLIC_REDIRECT_URI
ARG NEXT_PUBLIC_API_URL

# Copy dependency files first for Docker layer cache benefits
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --cache /root/.npm

# Copy build config files (these rarely change)
COPY tsconfig.json next.config.js postcss.config.js tailwind.config.js ./

# Copy source code and build
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,target=/app/.next/cache \
    NEXT_PUBLIC_SPOTIFY_CLIENT_ID=$NEXT_PUBLIC_SPOTIFY_CLIENT_ID \
    NEXT_PUBLIC_REDIRECT_URI=$NEXT_PUBLIC_REDIRECT_URI \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    npm run build

# Runtime stage
FROM node:18-alpine

# Create user before COPY to leverage --chown (more efficient than chown -R)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy with direct ownership to avoid expensive chown -R operation
COPY --from=builder --chown=appuser:appgroup /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=appuser:appgroup /app/.next ./.next

# Install only production dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline --cache /root/.npm --omit=dev

USER appuser

EXPOSE 3000

CMD ["npm", "run", "start"]
