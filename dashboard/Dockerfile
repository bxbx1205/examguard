# =======================================================
# Multi-stage Dockerfile for ExamGuard Dashboard
# Optimized for Google Cloud Run and Local Production
# =======================================================

# Stage 1: Build production static bundle
FROM node:20-alpine AS builder

WORKDIR /app

# Cache package dependencies
COPY package*.json ./
RUN npm ci || npm install

# Build arguments for dynamic API / WebSocket endpoints
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Production web server (Nginx Alpine)
FROM nginx:alpine

# Default PORT to 8080 (standard for Google Cloud Run)
ENV PORT=8080

# Configure Nginx template for dynamic $PORT injection and SPA client-side routing
RUN mkdir -p /etc/nginx/templates && printf 'server {\n\
    listen ${PORT};\n\
    server_name localhost;\n\
\n\
    location / {\n\
        root /usr/share/nginx/html;\n\
        index index.html index.htm;\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    location ~* \\.(?:css|js|jpg|jpeg|gif|png|ico|svg|woff|woff2|ttf|eot)$ {\n\
        root /usr/share/nginx/html;\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
\n\
    error_page 500 502 503 504 /50x.html;\n\
    location = /50x.html {\n\
        root /usr/share/nginx/html;\n\
    }\n\
}\n' > /etc/nginx/templates/default.conf.template

# Copy built artifacts from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
