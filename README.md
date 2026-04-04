# bestparts
Just the best parts of movies!

## Requirements

- npm and nvm
- Node.js `20.9.0` or newer
- A running PostgreSQL database (install postgres in advance or use Docker)
- A TMDB read access token if you want movie title autocomplete

## PostgreSQL setup

You need a PostgreSQL database before running Prisma migrations. Choose one of these options.

### Option 1: Local PostgreSQL

If PostgreSQL is already installed on your machine, create a local database and point the app at it.

1. Start PostgreSQL.
2. Create a database:

   ```bash
   createdb bestparts
   ```

3. Set `DATABASE_URL` in `.env` using your local PostgreSQL credentials:

   ```env
   DATABASE_URL="postgresql://<username>:<password>@localhost:5432/bestparts?schema=public"
   ```

If your local PostgreSQL user does not use a password, this also works:

```env
DATABASE_URL="postgresql://<username>@localhost:5432/bestparts?schema=public"
```

### Option 2: Docker

If you do not want to install PostgreSQL directly, run it in Docker:

```bash
docker run --name bestparts-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bestparts \
  -p 5432:5432 \
  -d postgres:16
```

Then use this in `.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bestparts?schema=public"
```

If you stop the container later, restart it with:

```bash
docker start bestparts-postgres
```

## Run locally

1. Install the required Node.js version.

   ```bash
   nvm use
   ```

   If you do not use `nvm`, install Node `20.9.0` or newer manually.

2. Install dependencies.

   ```bash
   npm install
   ```

3. Create your local environment file.

   ```bash
   cp .env.example .env
   ```

4. Update `DATABASE_URL` in `.env` to point at your PostgreSQL instance. Example:

   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bestparts?schema=public"
   TMDB_TOKEN="your_tmdb_read_access_token"
   ```

   `TMDB_TOKEN` is optional for basic use, but movie title suggestions will not work without it.

5. Create the database schema locally.

   ```bash
   npm run db:migrate
   ```

6. Start the development server.

   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000).

## Useful commands

- `npm run dev` starts the Next.js dev server
- `npm run build` generates the Prisma client, applies deploy migrations, and builds the app
- `npm run start` starts the production build
- `npm run db:migrate` creates and applies local Prisma migrations
- `npm run db:generate` regenerates the Prisma client
- `npm run db:studio` opens Prisma Studio
