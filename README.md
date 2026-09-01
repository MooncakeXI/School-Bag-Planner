# School Bag Planner

A web app that helps Thai elementary school students pack their school bag correctly
based on their class timetable. See [CLAUDE.md](./CLAUDE.md) for the full project brief,
domain model, and invariants — read that before making changes.

## Setup

```bash
cp .env.example .env          # fill in AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET
docker compose up -d          # Postgres, with a second `school_bag_test` database
npm install
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

Google OAuth credentials come from Google Cloud Console → APIs & Services → Credentials.
Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint
npm run typecheck
npm test             # unit + integration tests (needs the Postgres container running)
npx prisma migrate dev --name <name>
npx prisma studio
```
