import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';

// Banco local (offline-first). Toda escrita do app acontece primeiro aqui;
// o Supabase recebe os dados depois, pela sincronização.
let dbPromise = null;

export function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('checkfit.db').then(async (db) => {
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
}

async function migrate(db) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id           TEXT PRIMARY KEY NOT NULL,
      title        TEXT NOT NULL,
      category     TEXT NOT NULL,
      performed_at TEXT NOT NULL,
      duration_min INTEGER DEFAULT 0,
      notes        TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      deleted      INTEGER NOT NULL DEFAULT 0,
      synced       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id          TEXT PRIMARY KEY NOT NULL,
      workout_id  TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      sets        INTEGER NOT NULL DEFAULT 0,
      reps        INTEGER NOT NULL DEFAULT 0,
      weight_kg   REAL NOT NULL DEFAULT 0,
      -- Campos reservados para a Visão Computacional (2º bimestre):
      cv_reps     INTEGER,
      cv_score    REAL,
      cv_feedback TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      deleted     INTEGER NOT NULL DEFAULT 0,
      synced      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      at      TEXT NOT NULL,
      status  TEXT NOT NULL,
      pushed  INTEGER DEFAULT 0,
      pulled  INTEGER DEFAULT 0,
      message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ex_workout ON exercises(workout_id);
  `);

  const device = await db.getFirstAsync(`SELECT value FROM settings WHERE key = 'device_id'`);
  if (!device) {
    await db.runAsync(`INSERT INTO settings (key, value) VALUES ('device_id', ?)`, [Crypto.randomUUID()]);
  }
}

const now = () => new Date().toISOString();
export const uuid = () => Crypto.randomUUID();

/* ---------------- Settings / perfil ---------------- */

export async function getSetting(key) {
  const db = await getDb();
  const row = await db.getFirstAsync(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : null;
}

export async function setSetting(key, value) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

/* ---------------- Treinos ---------------- */

export async function listWorkouts() {
  const db = await getDb();
  return db.getAllAsync(`
    SELECT w.*,
           COUNT(e.id)                                   AS exercise_count,
           COALESCE(SUM(e.sets * e.reps * e.weight_kg), 0) AS volume
      FROM workouts w
      LEFT JOIN exercises e ON e.workout_id = w.id AND e.deleted = 0
     WHERE w.deleted = 0
     GROUP BY w.id
     ORDER BY w.performed_at DESC, w.created_at DESC
  `);
}

export async function getWorkout(id) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM workouts WHERE id = ? AND deleted = 0`, [id]);
}

export async function saveWorkout(data) {
  const db = await getDb();
  const ts = now();
  if (data.id) {
    await db.runAsync(
      `UPDATE workouts SET title=?, category=?, performed_at=?, duration_min=?, notes=?,
              updated_at=?, synced=0 WHERE id=?`,
      [data.title, data.category, data.performed_at, data.duration_min || 0, data.notes || '', ts, data.id]
    );
    return data.id;
  }
  const id = uuid();
  await db.runAsync(
    `INSERT INTO workouts (id, title, category, performed_at, duration_min, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.title, data.category, data.performed_at, data.duration_min || 0, data.notes || '', ts, ts]
  );
  return id;
}

// Exclusão lógica: o registro continua no SQLite até a sync avisar o Supabase.
export async function deleteWorkout(id) {
  const db = await getDb();
  const ts = now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE workouts SET deleted=1, synced=0, updated_at=? WHERE id=?`, [ts, id]);
    await db.runAsync(`UPDATE exercises SET deleted=1, synced=0, updated_at=? WHERE workout_id=?`, [ts, id]);
  });
}

/* ---------------- Exercícios ---------------- */

export async function listExercises(workoutId) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM exercises WHERE workout_id = ? AND deleted = 0 ORDER BY created_at ASC`,
    [workoutId]
  );
}

export async function saveExercise(data) {
  const db = await getDb();
  const ts = now();
  if (data.id) {
    await db.runAsync(
      `UPDATE exercises SET name=?, sets=?, reps=?, weight_kg=?, updated_at=?, synced=0 WHERE id=?`,
      [data.name, data.sets, data.reps, data.weight_kg, ts, data.id]
    );
  } else {
    await db.runAsync(
      `INSERT INTO exercises (id, workout_id, name, sets, reps, weight_kg, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), data.workout_id, data.name, data.sets, data.reps, data.weight_kg, ts, ts]
    );
  }
  // Alterar um exercício também marca o treino como "alterado"
  await db.runAsync(`UPDATE workouts SET updated_at=?, synced=0 WHERE id=?`, [ts, data.workout_id]);
}

export async function deleteExercise(id) {
  const db = await getDb();
  const ts = now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE exercises SET deleted=1, synced=0, updated_at=? WHERE id=?`, [ts, id]);
    // Remover um exercício também marca o treino como "alterado" (selo "Só no aparelho")
    await db.runAsync(
      `UPDATE workouts SET updated_at=?, synced=0 WHERE id = (SELECT workout_id FROM exercises WHERE id=?)`,
      [ts, id]
    );
  });
}

/* ---------------- Visão Computacional (2º bimestre) ---------------- */

// Grava o resultado da análise de postura no exercício (SQLite primeiro).
// synced = 0 faz a próxima sincronização enviar cv_reps/cv_score/cv_feedback ao Supabase.
export async function saveCvResult(exerciseId, { reps, score, feedback }) {
  const db = await getDb();
  const ts = now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE exercises SET cv_reps=?, cv_score=?, cv_feedback=?, updated_at=?, synced=0 WHERE id=?`,
      [reps, score, feedback || null, ts, exerciseId]
    );
    await db.runAsync(
      `UPDATE workouts SET updated_at=?, synced=0 WHERE id = (SELECT workout_id FROM exercises WHERE id=?)`,
      [ts, exerciseId]
    );
  });
}

export async function getExercise(id) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT * FROM exercises WHERE id = ? AND deleted = 0`, [id]);
}

// Histórico de carga de um exercício (pelo nome) para mostrar a progressão
export async function exerciseHistory(name) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT w.performed_at, e.sets, e.reps, e.weight_kg, e.cv_score, e.cv_reps
       FROM exercises e JOIN workouts w ON w.id = e.workout_id
      WHERE LOWER(e.name) = LOWER(?) AND e.deleted = 0 AND w.deleted = 0
      ORDER BY w.performed_at DESC LIMIT 5`,
    [name]
  );
}

/* ---------------- Indicadores ---------------- */

export async function getStats() {
  const db = await getDb();
  // Últimos 7 dias contando hoje, no fuso do aparelho (performed_at é a data local AAAA-MM-DD)
  const start = new Date(Date.now() - 6 * 86400000);
  const weekAgo = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const total = await db.getFirstAsync(`SELECT COUNT(*) AS n FROM workouts WHERE deleted=0`);
  const week = await db.getFirstAsync(
    `SELECT COUNT(*) AS n, COALESCE(SUM(duration_min),0) AS minutes
       FROM workouts WHERE deleted=0 AND performed_at >= ?`,
    [weekAgo]
  );
  // Volume da semana: soma de séries × repetições × carga dos exercícios dos últimos 7 dias
  const volume = await db.getFirstAsync(
    `SELECT COALESCE(SUM(e.sets * e.reps * e.weight_kg), 0) AS kg
       FROM exercises e JOIN workouts w ON w.id = e.workout_id
      WHERE e.deleted = 0 AND w.deleted = 0 AND w.performed_at >= ?`,
    [weekAgo]
  );
  // Resultado da Visão Computacional: nota média de postura nas análises da semana
  const posture = await db.getFirstAsync(
    `SELECT AVG(e.cv_score) AS avg, COUNT(e.cv_score) AS n
       FROM exercises e JOIN workouts w ON w.id = e.workout_id
      WHERE e.deleted = 0 AND w.deleted = 0 AND e.cv_score IS NOT NULL AND w.performed_at >= ?`,
    [weekAgo]
  );
  const pending = await countPending();
  return {
    total: total.n, week: week.n, weekMinutes: week.minutes, weekVolume: volume.kg, pending,
    postureAvg: posture.avg == null ? null : Math.round(posture.avg), postureCount: posture.n,
  };
}

export async function countPending() {
  const db = await getDb();
  const w = await db.getFirstAsync(`SELECT COUNT(*) AS n FROM workouts WHERE synced=0`);
  const e = await db.getFirstAsync(`SELECT COUNT(*) AS n FROM exercises WHERE synced=0`);
  return w.n + e.n;
}

/* ---------------- Inspeção (usado na tela de demonstração) ---------------- */

export async function inspectTable(table) {
  const allowed = ['workouts', 'exercises', 'sync_log'];
  if (!allowed.includes(table)) throw new Error('Tabela inválida');
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 20`);
}
