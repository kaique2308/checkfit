import NetInfo from '@react-native-community/netinfo';
import { getDb, getSetting } from '../db/database';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

/*
 * Estratégia offline-first:
 * 1. PUSH: tudo que está com synced = 0 no SQLite vai para o Supabase (upsert).
 * 2. PULL: baixa os registros do usuário no Supabase e grava no SQLite
 *    quando o registro não existe localmente ou quando a versão remota é mais nova
 *    (e não há alteração local pendente). Regra: last-write-wins por updated_at.
 */

const bool = (v) => (v ? true : false);
// true se a versão local é igual ou mais nova que a remota
const newer = (localTs, remoteTs) => Date.parse(localTs) >= Date.parse(remoteTs);

async function logSync(db, status, pushed, pulled, message) {
  await db.runAsync(
    `INSERT INTO sync_log (at, status, pushed, pulled, message) VALUES (?, ?, ?, ?, ?)`,
    [new Date().toISOString(), status, pushed, pulled, message || null]
  );
}

export async function syncNow() {
  const db = await getDb();

  if (!isSupabaseConfigured) {
    throw new Error('Supabase não configurado. Preencha o arquivo .env.');
  }
  const net = await NetInfo.fetch();
  if (!net.isConnected) {
    await logSync(db, 'offline', 0, 0, 'Sem conexão, dados mantidos no SQLite');
    throw new Error('Sem internet. Seus dados estão salvos no aparelho.');
  }

  const deviceId = await getSetting('device_id');
  const userName = (await getSetting('user_name')) || 'Aluno';

  try {
    const pushed = await push(db, deviceId, userName);
    const pulled = await pull(db, deviceId);
    await logSync(db, 'ok', pushed, pulled);
    return { pushed, pulled };
  } catch (err) {
    await logSync(db, 'erro', 0, 0, err.message);
    throw err;
  }
}

async function push(db, deviceId, userName) {
  const workouts = await db.getAllAsync(`SELECT * FROM workouts WHERE synced = 0`);
  const exercises = await db.getAllAsync(`SELECT * FROM exercises WHERE synced = 0`);

  if (workouts.length) {
    const payload = workouts.map((w) => ({
      id: w.id,
      device_id: deviceId,
      user_name: userName,
      title: w.title,
      category: w.category,
      performed_at: w.performed_at,
      duration_min: w.duration_min,
      notes: w.notes,
      created_at: w.created_at,
      updated_at: w.updated_at,
      deleted: bool(w.deleted),
    }));
    const { error } = await supabase.from('workouts').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error('Erro ao enviar treinos: ' + error.message);
  }

  if (exercises.length) {
    const payload = exercises.map((e) => ({
      id: e.id,
      workout_id: e.workout_id,
      device_id: deviceId,
      name: e.name,
      sets: e.sets,
      reps: e.reps,
      weight_kg: e.weight_kg,
      cv_reps: e.cv_reps,
      cv_score: e.cv_score,
      cv_feedback: e.cv_feedback,
      created_at: e.created_at,
      updated_at: e.updated_at,
      deleted: bool(e.deleted),
    }));
    const { error } = await supabase.from('exercises').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error('Erro ao enviar exercícios: ' + error.message);
  }

  await db.withTransactionAsync(async () => {
    for (const w of workouts) {
      await db.runAsync(`UPDATE workouts SET synced = 1 WHERE id = ? AND updated_at = ?`, [w.id, w.updated_at]);
    }
    for (const e of exercises) {
      await db.runAsync(`UPDATE exercises SET synced = 1 WHERE id = ? AND updated_at = ?`, [e.id, e.updated_at]);
    }
  });

  return workouts.length + exercises.length;
}

async function pull(db, deviceId) {
  const { data: rw, error: e1 } = await supabase.from('workouts').select('*').eq('device_id', deviceId);
  if (e1) throw new Error('Erro ao baixar treinos: ' + e1.message);
  const { data: re, error: e2 } = await supabase.from('exercises').select('*').eq('device_id', deviceId);
  if (e2) throw new Error('Erro ao baixar exercícios: ' + e2.message);

  let pulled = 0;
  await db.withTransactionAsync(async () => {
    for (const w of rw) {
      const local = await db.getFirstAsync(`SELECT updated_at, synced FROM workouts WHERE id = ?`, [w.id]);
      if (local && (local.synced === 0 || newer(local.updated_at, w.updated_at))) continue;
      await db.runAsync(
        `INSERT INTO workouts (id, title, category, performed_at, duration_min, notes, created_at, updated_at, deleted, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, category=excluded.category,
           performed_at=excluded.performed_at, duration_min=excluded.duration_min, notes=excluded.notes,
           updated_at=excluded.updated_at, deleted=excluded.deleted, synced=1`,
        [w.id, w.title, w.category, w.performed_at, w.duration_min, w.notes, w.created_at, w.updated_at, w.deleted ? 1 : 0]
      );
      pulled++;
    }
    for (const e of re) {
      const local = await db.getFirstAsync(`SELECT updated_at, synced FROM exercises WHERE id = ?`, [e.id]);
      if (local && (local.synced === 0 || newer(local.updated_at, e.updated_at))) continue;
      await db.runAsync(
        `INSERT INTO exercises (id, workout_id, name, sets, reps, weight_kg, cv_reps, cv_score, cv_feedback, created_at, updated_at, deleted, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, sets=excluded.sets, reps=excluded.reps,
           weight_kg=excluded.weight_kg, cv_reps=excluded.cv_reps, cv_score=excluded.cv_score,
           cv_feedback=excluded.cv_feedback, updated_at=excluded.updated_at, deleted=excluded.deleted, synced=1`,
        [e.id, e.workout_id, e.name, e.sets, e.reps, e.weight_kg, e.cv_reps, e.cv_score, e.cv_feedback,
         e.created_at, e.updated_at, e.deleted ? 1 : 0]
      );
      pulled++;
    }
  });
  return pulled;
}

// Usado na apresentação: apaga o SQLite e restaura tudo a partir do Supabase,
// provando que os dados estão persistidos online.
export async function wipeLocalAndRestore() {
  const db = await getDb();
  // Verifica Supabase e internet ANTES de apagar, para não deixar o app vazio
  if (!isSupabaseConfigured) {
    throw new Error('Supabase não configurado. Preencha o arquivo .env.');
  }
  const net = await NetInfo.fetch();
  if (!net.isConnected) {
    throw new Error('Sem internet. Conecte-se antes de restaurar os dados da nuvem.');
  }
  const pending = await db.getFirstAsync(
    `SELECT (SELECT COUNT(*) FROM workouts WHERE synced=0) + (SELECT COUNT(*) FROM exercises WHERE synced=0) AS n`
  );
  if (pending.n > 0) throw new Error('Existem alterações não sincronizadas. Sincronize antes de restaurar.');
  await db.execAsync(`DELETE FROM exercises; DELETE FROM workouts;`);
  return syncNow();
}

export async function lastSyncs() {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM sync_log ORDER BY id DESC LIMIT 5`);
}
