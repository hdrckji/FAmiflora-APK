// Cache persistant des fiches d'entretien.
// Utilise PostgreSQL si DATABASE_URL est defini (recommande sur Railway),
// sinon un cache memoire (perdu au redemarrage) pour developper en local.
import pg from "pg";

let pool = null;
const memory = new Map();     // fiches d'entretien
const memoryReco = new Map(); // fiches conseiller (attributs)

export async function initCache() {
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Railway PostgreSQL exige SSL. Mettre PGSSL=disable pour un Postgres local sans SSL.
      ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS care_sheets (
        key        text PRIMARY KEY,
        data       jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reco_sheets (
        id         text PRIMARY KEY,
        data       jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log("[cache] PostgreSQL pret");
  } else {
    console.log("[cache] memoire (aucun DATABASE_URL) - non persistant");
  }
}

export async function getCached(key) {
  if (pool) {
    const r = await pool.query("SELECT data FROM care_sheets WHERE key = $1", [key]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  return memory.has(key) ? memory.get(key) : null;
}

export async function setCached(key, data) {
  if (pool) {
    await pool.query(
      `INSERT INTO care_sheets (key, data) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
      [key, data]
    );
  } else {
    memory.set(key, data);
  }
}

export async function countCached() {
  if (pool) {
    const r = await pool.query("SELECT count(*)::int AS n FROM care_sheets");
    return r.rows[0].n;
  }
  return memory.size;
}

// ---- Fiches conseiller (attributs de recommandation) ----
export async function getReco(id) {
  if (pool) {
    const r = await pool.query("SELECT data FROM reco_sheets WHERE id = $1", [id]);
    return r.rows[0] ? r.rows[0].data : null;
  }
  return memoryReco.has(id) ? memoryReco.get(id) : null;
}

export async function setReco(id, data) {
  if (pool) {
    await pool.query(
      `INSERT INTO reco_sheets (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, data]
    );
  } else {
    memoryReco.set(id, data);
  }
}

export async function allReco() {
  if (pool) {
    const r = await pool.query("SELECT id, data FROM reco_sheets");
    return r.rows.map((x) => ({ id: x.id, data: x.data }));
  }
  return [...memoryReco.entries()].map(([id, data]) => ({ id, data }));
}
