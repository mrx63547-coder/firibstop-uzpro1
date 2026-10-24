FROM node:20-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json server.js index.html sw.js manifest.webmanifest icon.svg icon-192.png icon-512.png scams.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node","server.js"]
