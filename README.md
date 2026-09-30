This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local development

One codebase serves the public site and the private research app (`/app` for
researchers, `/admin`, `/auth`). Requires Node 22, Docker and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (2.106+).

1. **Install:** `npm ci`, then `npx playwright install chromium webkit` (once, for browser tests).
2. **Start local Supabase:** `npm run db:start` (stop with `npm run db:stop`). It
   uses ports 54421–54429 so it can run beside other local Supabase projects:
   - API `http://127.0.0.1:54421`, Postgres `postgresql://postgres:postgres@127.0.0.1:54422/postgres`
   - Studio `http://127.0.0.1:54423`
   - Captured-email inbox (Mailpit) `http://127.0.0.1:54424` — every email the app sends locally lands here.
3. **Environment:** copy `.env.example` to `.env.local`. Fill the Supabase values
   from `npm run db:status` (`API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`). Never
   commit `.env.local`.
4. **Run:** `npm run dev`.
   - Without `APP_HOST`, everything is on `http://localhost:3000` (public pages, `/app`, `/admin`, `/auth`).
   - With `APP_HOST=app.localhost:3000` and `PUBLIC_HOST=www.localhost:3000`, the
     app lives on `http://app.localhost:3000` and the public site on
     `http://www.localhost:3000`, as in production (`app.alphaprlabs.com`).
     Browsers resolve `*.localhost` to your machine. Don't use plain
     `localhost:3000` as `PUBLIC_HOST`: the dev server would turn that redirect
     into a relative one and loop.
5. **Database:** migrations live in `supabase/migrations/` and apply on
   `npm run db:start` for a new stack; `npm run db:reset` rebuilds the local
   database from them (wipes local data). After a schema change run
   `npm run db:types` and commit `src/lib/supabase/database.types.ts`.
6. **First admin:** there is no public signup or role selection. Create (or
   promote) an admin with the secret key from `.env.local`:
   `npm run admin:create -- --email you@example.com --name "Your Name" [--password '…']`.
   Without `--password` a new account gets a random password printed once
   (or use "Forgot password?"). Researchers join only through invitations
   (Admin → Invitations); their emails, and recovery emails, land in Mailpit.
7. **Reminders (Web Push):** run `npm run push:keys` and put the pair in
   `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, with
   `VAPID_SUBJECT=mailto:…` (one pair per environment; never commit keys).
   `PUSH_TEST_ENABLED=true` shows "Send test notification" under
   Me → Notifications (gate G1 only). Browsers allow push only over HTTPS or
   on `localhost`/`*.localhost`. The app icons in `public/app-icons/` come from
   `scripts/app-icons.sh` (ImageMagick).
8. **Checks:** `npm run lint`, `npm run typecheck`, `npm test` (Vitest unit
   tests plus `tests/integration`, which run against the local Supabase) and
   `npm run test:e2e` (Playwright; builds and starts the app on port 3100 with
   host routing on). Both test commands need `npm run db:start` first; they
   read the keys from `supabase status` and create uniquely named accounts and
   invitations per run, so no reset is needed between runs (`npm run db:reset`
   clears the accumulated test rows).

**Email and auth settings for a hosted Supabase project** (set at deploy time,
not in this repo): Auth → Sign-ups off (invitation only), minimum password
length 8, Site URL `https://app.alphaprlabs.com` and redirect URL
`https://app.alphaprlabs.com/**`; Auth → SMTP (Postmark: host
`smtp.postmarkapp.com`, port 587, user and password = the server API token,
sender address); Auth → Email templates → Reset password: subject and body
from `supabase/config.toml` / `supabase/templates/recovery.html`. The app's
own invitation email uses the `SMTP_*` variables in `.env.example`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
