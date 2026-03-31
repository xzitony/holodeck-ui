#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Seeding database (if needed)..."
node prisma/seed.js

echo "Starting Next.js server..."
exec node server.js
