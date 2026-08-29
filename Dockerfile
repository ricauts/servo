# Servo — self-hosted AI service desk (POC image).
# Single-stage on purpose: the runtime keeps the Prisma CLI + tsx so the
# container can create and seed its own SQLite database on first boot.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching. .npmrc must ride
# along: it relaxes peer resolution (next-auth beta vs nodemailer 9), and
# without it npm ci fails inside the image.
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund && npx prisma generate

# Build the app.
COPY . .
RUN npm run build

# The app container is stateless: the database is the `db` service; see
# docker-compose.yml. Prisma migrations ride in the image (COPY prisma ./prisma).
# OPS_DATABASE_URL carries no default: the ops sandbox is a PostgreSQL
# database now (db-05), and an image-level `file:` path would only be a
# backend the code no longer speaks. docker-compose.yml sets it; an install
# that does not gets a message naming the variable and the migration guide,
# and — because the entrypoint runs under `set -e` — a SERVO_DEMO=1 first boot
# stops there rather than seeding. That is deliberate: the demo seed wipes the
# desk, so refusing before it starts beats half-seeding one.
ENV NODE_ENV=production \
    DATABASE_URL="file:/data/servo.db" \
    PORT=3000 \
    HOSTNAME=0.0.0.0

EXPOSE 3000

# Belt and braces alongside .gitattributes: strip CR so a working copy that
# was checked out with CRLF (Windows default) still produces a runnable
# entrypoint instead of "no such file or directory" on its shebang.
RUN sed -i 's/\r$//' ./scripts/docker-entrypoint.sh && chmod +x ./scripts/docker-entrypoint.sh
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
