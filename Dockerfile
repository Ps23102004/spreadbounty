# Spreadbounty public demo image (the deploy judges click).
# Run with: docker build -t spreadbounty . && docker run -p 8787:8787 spreadbounty
# Hosts that take a Dockerfile (Render, Railway, Fly.io) need nothing else:
# the start command, PORT handling and the PUBLIC_DEMO sandbox are baked in.
FROM node:22-slim
WORKDIR /app

# Deps first, for layer caching
COPY spreadbounty/package.json spreadbounty/package-lock.json ./
# Test-only ganache compiles native modules (no compiler in node:22-slim) and ships a nested macOS-only fsevents that Linux's npm
# rejects with EBADPLATFORM. The site needs neither, so skip install scripts and the platform check.
RUN npm ci --no-audit --no-fund --ignore-scripts --force

# App source (server + web + scoring core)
COPY spreadbounty/ ./

# Bake the labelled demo dataset and the production web bundle into the image
RUN npm run demo:gen && npm run build:web

ENV NODE_ENV=production \
    PORT=8787 \
    PUBLIC_DEMO=1
EXPOSE 8787
CMD ["npm", "run", "serve"]
