# AgriConnect Website

Next.js frontend for the AgriConnect farm-to-home marketplace.

## Run locally

```powershell
cd website
npm ci
copy .env.example .env.local
npm run dev
```

Open http://localhost:3000.

## Production build

```powershell
npm ci
npm run lint
npm run build
npm run start
```

Required environment variables are documented in `.env.example`.
