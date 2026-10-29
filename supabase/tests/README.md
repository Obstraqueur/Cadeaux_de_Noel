# Tests de la base

Ces tests vérifient les règles de sécurité (surprises, réservations, amis secrets, calendrier)
dans un vrai Postgres qui tourne dans Node (PGlite), sans toucher au projet Supabase.

```bash
cd supabase/tests
npm init -y && npm install @electric-sql/pglite@0.5.13
node test_db.mjs
```
