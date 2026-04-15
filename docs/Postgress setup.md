# PostgreSQL setup

You need PostgreSQL before running Prisma migrations or the integration test workflow. Keep the application database and test database separate. The current test helpers expect `DATABASE_URL_TEST` to point at a dedicated database or dedicated schema that is not the same value as `DATABASE_URL`.

Recommended local names:

- App database: `bestparts`
- Test database: `bestparts_test`

## Option 1: Local PostgreSQL

If PostgreSQL is already installed on your machine, create a local database and point the app at it.

1. Start PostgreSQL. You probably installed if via homebrew.
2. Create the app and test databases:

```bash
createdb bestparts
createdb bestparts_test
```
   
3. Set both database URLs in `.env` using your local PostgreSQL credentials. If you used the default setup there won't be a password. Your username should match your login username.

```env
DATABASE_URL="postgresql://<username>@localhost:5432/bestparts?schema=public"
DATABASE_URL_TEST="postgresql://<username>@localhost:5432/bestparts_test?schema=public"
```

## Option 2: Docker

If you do not want to install PostgreSQL directly, run it in Docker:

```bash
docker run --name bestparts-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bestparts \
  -p 5432:5432 \
  -d postgres:16
```

Create the separate test database after the container is running:

```bash
docker exec bestparts-postgres createdb -U postgres bestparts_test
```

Then use this in `.env`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/bestparts?schema=public"
DATABASE_URL_TEST="postgresql://postgres:postgres@localhost:5432/bestparts_test?schema=public"
```

If you stop the container later, restart it with:

```bash
docker start bestparts-postgres
```
