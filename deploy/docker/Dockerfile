# DataBrief - Docker image based on nginx (unprivileged: runs without root). Small and production-grade.
# Published as ghcr.io/arfo-du-blo/databrief:latest and :nginx
#
# Build (from the repository root):
#   docker build -f deploy/docker/Dockerfile -t databrief .
# Run:
#   docker run -d -p 8080:8080 -e DATABRIEF_LANG=fr databrief
#
# Settings: DATABRIEF_* environment variables (see README, "Settings"). They are written into the page
# and the nginx configuration at every container start (/docker-entrypoint.d/40-databrief.sh).
FROM nginxinc/nginx-unprivileged:stable-alpine

USER root
RUN apk add --no-cache jq \
 && mkdir -p /opt/databrief /var/www/databrief \
 && chown -R 101:101 /var/www/databrief /etc/nginx/conf.d \
 && chown 101:101 /etc/nginx/nginx.conf
COPY databrief.html /opt/databrief/databrief.html
COPY deploy/docker/40-databrief.sh /docker-entrypoint.d/40-databrief.sh
RUN chmod 755 /docker-entrypoint.d/40-databrief.sh
USER 101

ENV DATABRIEF_PORT=8080 \
    DATABRIEF_BASE_PATH=/ \
    DATABRIEF_MAX_CONNECTIONS=1024 \
    DATABRIEF_ACCESS_LOG=true \
    DATABRIEF_FRAME_ANCESTORS="'self'"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null "http://127.0.0.1:${DATABRIEF_PORT}/healthz" || exit 1

LABEL org.opencontainers.image.title="DataBrief" \
      org.opencontainers.image.description="Turn any data file into an AI-ready prompt. 100% offline, in the browser." \
      org.opencontainers.image.source="https://github.com/Arfo-du-blo/DataBrief" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"
