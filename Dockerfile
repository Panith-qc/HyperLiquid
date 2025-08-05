# Multi-stage build for optimized production image
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs && adduser -S trading -u 1001

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=trading:nodejs /app/dist ./dist
COPY --from=builder --chown=trading:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=trading:nodejs /app/package*.json ./

# Create necessary directories
RUN mkdir -p logs data && chown -R trading:nodejs logs data

# Switch to non-root user
USER trading

# Expose ports
EXPOSE 3000 3001 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node dist/health-check.js || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]