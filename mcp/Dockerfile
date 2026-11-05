# DataBrief hosted MCP server - Docker image (Node.js, no dependency, runs without root, writes nothing).
#
# Build, from the repository root. The image builds the widget page itself (databrief.html + widget/, with tools/build-widget.cjs),
# so it can never ship a stale copy:
#   docker build -f mcp/Dockerfile -t databrief-mcp .
#   docker build -f mcp/Dockerfile --build-arg WIDGET_SOURCE=fixture -t databrief-mcp:test .   (a stand-in page, for tests)
# Run:
#   docker run -d -p 8787:8787 --read-only --cap-drop ALL --security-opt no-new-privileges databrief-mcp
# The connector address is then http://localhost:8787/mcp (put it behind HTTPS: a reverse proxy or a tunnel).
# Settings: DATABRIEF_MCP_* and related environment variables, see docs/mcp-server.md.
ARG WIDGET_SOURCE=built

FROM node:22-alpine AS widget-built
WORKDIR /src
COPY package.json databrief.html ./
COPY widget/ widget/
COPY tools/build-widget.cjs tools/
RUN node tools/build-widget.cjs /out/databrief-widget.html

FROM node:22-alpine AS widget-fixture
COPY tests/mcp-fixtures/widget.html /out/databrief-widget.html

FROM widget-${WIDGET_SOURCE} AS widget

FROM node:22-alpine
WORKDIR /app
COPY mcp/server.js mcp/uris.json mcp/home-i18n.json mcp/icon.svg package.json ./
COPY --from=widget /out/databrief-widget.html /app/widget.html

USER node
ENV DATABRIEF_MCP_PORT=8787 \
    DATABRIEF_MCP_HOST=0.0.0.0
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null "http://127.0.0.1:${DATABRIEF_MCP_PORT}/healthz" || exit 1

LABEL org.opencontainers.image.title="DataBrief MCP server" \
      org.opencontainers.image.description="The hosted MCP server behind the DataBrief connector for Claude and ChatGPT. It never receives your files." \
      org.opencontainers.image.source="https://github.com/Arfo-du-blo/DataBrief" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

CMD ["node", "server.js"]
