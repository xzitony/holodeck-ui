# Holodeck UI

Web-based management interface for VMware VCF 9 Holodeck deployments. Provides a guided deployment wizard, Day 2 operations, PowerShell command execution, reservation scheduling, and user management — all driven through SSH to a holorouter VM.

If you run a Holodeck lab environment and want a web UI instead of managing everything through PowerShell on the holorouter directly, this is for you.

## Tech Stack

- **Framework**: Next.js 16 (App Router, React 19)
- **Database**: SQLite via Prisma ORM
- **Auth**: JWT (httpOnly cookies), bcrypt password hashing
- **SSH**: `ssh2` library for holorouter communication
- **Background Jobs**: tmux sessions for long-running operations
- **Styling**: Tailwind CSS 4 with dark theme
- **API Docs**: Swagger UI (OpenAPI 3.0)
- **Deployment**: Docker + Caddy reverse proxy

## Features

- **Deploy Wizard** — Multi-step form for launching VCF deployments (VVF, Management, Full Stack, Dual Site)
- **Day 2 Operations** — Add clusters, ESXi nodes, or VCF Automation to existing deployments
- **Live Output Monitoring** — Real-time tmux output capture with auto-scroll
- **Command Runner** — Execute PowerShell commands with parameter forms, SSE streaming output
- **Reservation System** — Time slot booking with overlap warnings, maintenance windows, customer demo flags
- **Role-Based Access** — Three roles: `user`, `labadmin`, `superadmin` with granular permissions
- **Global Configuration** — Centralized SSH, ESXi, depot, and UI customization settings
- **Environment Links** — Dynamic link dashboard with capability-aware conditional visibility
- **Audit Logging** — Full history of logins, commands, deployments, and reservations
- **API Documentation** — Built-in Swagger UI at `/dashboard/developer`

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Set up database
cp .env.example .env
npx prisma migrate dev
npx prisma db seed

# Start dev server
npm run dev
```

The app runs at `http://localhost:3000`. Default login:
- **Username**: `admin`
- **Password**: `HoloDeck!Admin1`

> **Note:** Change the default admin password after first login. You can manage users and passwords from the Admin panel once logged in.

### Docker

```bash
# Set required environment variables
export JWT_SECRET="your-secret-key"

# Build and run
./build.sh

# Or manually:
docker compose up --build
```

The container runs behind a Caddy reverse proxy on ports 80/443.

### Production (Portainer / Docker Compose)

A standalone `docker-compose.prod.yml` is provided for production deployments. It pulls a prebuilt image from GitHub Container Registry:

```bash
# Download the production compose file
curl -O https://raw.githubusercontent.com/xzitony/holodeck-ui/main/docker-compose.prod.yml

# Set required env vars and deploy
export JWT_SECRET="your-secret-key"
docker compose -f docker-compose.prod.yml up -d
```

This file is also designed to be pasted directly into a **Portainer Stack** — just set the `JWT_SECRET` environment variable in the Portainer UI and deploy.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | SQLite database path | `file:/app/data/holodeck.db` |
| `JWT_SECRET` | Secret key for JWT signing | (required) |
| `DOMAIN` | Domain for Caddy TLS | `localhost` |

SSH and deployment settings are configured through the Global Config page in the UI, not environment variables.

## Project Structure

```
src/
  app/
    api/                  # API routes
      auth/               # Login, logout, session
      config/             # Global config, SSH status, build info
      commands/           # Command CRUD, execution (SSE), configs
      deployments/        # Deployment jobs (CRUD, output capture)
      day2/               # Day 2 operations
      reservations/       # Reservation CRUD, overlap detection
      users/              # User management
      audit/              # Audit log queries
    dashboard/            # UI pages
      deploy/             # Deployment wizard
      day2/               # Day 2 operations
      deployments/        # Job list + live output viewer
      commands/           # Command runner
      reservations/       # Reservation scheduler
      environment/        # Environment link dashboard
      developer/          # Swagger API docs
      admin/              # Config, users, commands, reservations management
  lib/
    ssh.ts                # SSH connection, tmux management, env block builder
    auth.ts               # JWT verification, user extraction
    db.ts                 # Prisma client singleton
    validators.ts         # Zod schemas, template resolution
    reservation-guard.ts  # Reservation access checks
  components/
    layout/               # Sidebar, header, build footer
    reservations/         # Active reservation banner
  providers/              # Auth and UI context providers
  hooks/                  # useAuth, useReservation hooks
prisma/
  schema.prisma           # Database schema
  migrations/             # Migration history
  seed.ts                 # Dev seed (TypeScript)
  seed.js                 # Production seed (JavaScript)
config/
  commands.json           # Default command definitions
  environment-links.json  # Environment link definitions
```

## Database Models

| Model | Purpose |
|-------|---------|
| `User` | Accounts with roles (user/labadmin/superadmin) |
| `GlobalConfig` | Key-value settings (SSH, ESXi, depot, UI) |
| `CommandDefinition` | PowerShell command templates with parameters |
| `Reservation` | Time slot bookings with maintenance/demo flags |
| `BackgroundJob` | Deployment and Day 2 operation tracking |
| `AuditLog` | Action history for all operations |

## Architecture

### SSH & Command Execution

All holorouter communication goes through `src/lib/ssh.ts`:
- **Short commands** use the `ssh2` library directly with a persistent connection
- **Long-running operations** (deployments, Day 2 ops) spawn a local tmux session that wraps an SSH command to the holorouter
- Output is captured by polling `tmux capture-pane` and served to the browser

### Role Hierarchy

| Role | Capabilities |
|------|-------------|
| `user` | View environment, run basic commands, create reservations |
| `labadmin` | Deploy, Day 2 ops, run all commands (requires active reservation) |
| `superadmin` | Full access, manage users/config/commands, bypass reservations |

### Reservation System

- Users book time slots; overlapping reservations trigger confirmation warnings
- Lab admins can flag reservations as **maintenance windows** (banner visible to all users)
- Users can flag reservations as **customer demos** (escalated warnings for lab admins)
- Lab admins must have an active reservation to deploy; superadmins bypass this

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Seed the database |
| `npm run db:studio` | Open Prisma Studio |
| `./build.sh` | Docker build with git SHA and timestamp |

## Docker Details

The `Dockerfile` uses a multi-stage build:
1. **deps** — Install npm dependencies
2. **builder** — Build Next.js with Prisma generation
3. **runner** — Alpine production image with tmux, openssh-client, sshpass

The entrypoint runs Prisma migrations and seeds before starting the server. Data persists via a volume mount at `./data`.

## Contributing

Issues and pull requests are welcome. If you run into a problem or have a feature request, please [open an issue](https://github.com/xzitony/holodeck-ui/issues).

## License

[MIT](LICENSE)
