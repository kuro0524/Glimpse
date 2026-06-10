import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

let _db = null;
const PHOTOS_DIR = `${FileSystem.cacheDirectory}glimpse_photos/`;

export async function getDB() {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('glimpse.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      uri TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      taken_at INTEGER,
      added_at INTEGER DEFAULT (strftime('%s','now')),
      sort_order INTEGER DEFAULT 0,
      is_favorite INTEGER DEFAULT 0
    );
  `);
  const info = await FileSystem.getInfoAsync(PHOTOS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
  return _db;
}

// ─── Albums ──────────────────────────────────────────────────────────────────

export async function getAlbums(parentId = null) {
  const db = await getDB();
  if (parentId === null) {
    return db.getAllAsync(
      `SELECT * FROM albums WHERE parent_id IS NULL ORDER BY sort_order ASC, created_at ASC`
    );
  }
  return db.getAllAsync(
    `SELECT * FROM albums WHERE parent_id = ? ORDER BY sort_order ASC, created_at ASC`,
    [parentId]
  );
}

export async function getAllAlbums() {
  const db = await getDB();
  return db.getAllAsync(`SELECT * FROM albums ORDER BY sort_order ASC, name ASC`);
}

export async function createAlbum(name, parentId = null) {
  const db = await getDB();
  const id = `alb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const row = await db.getFirstAsync(
    `SELECT MAX(sort_order) AS m FROM albums WHERE parent_id IS ?`, [parentId]
  );
  await db.runAsync(
    `INSERT INTO albums (id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)`,
    [id, name, parentId, (row?.m ?? -1) + 1]
  );
  return id;
}

export async function renameAlbum(id, name) {
  const db = await getDB();
  await db.runAsync(`UPDATE albums SET name = ? WHERE id = ?`, [name, id]);
}

export async function deleteAlbum(id) {
  const db = await getDB();
  const photos = await db.getAllAsync(`SELECT uri FROM photos WHERE album_id = ?`, [id]);
  for (const p of photos) {
    await FileSystem.deleteAsync(p.uri, { idempotent: true });
  }
  await db.runAsync(`DELETE FROM photos WHERE album_id = ?`, [id]);
  const subs = await db.getAllAsync(`SELECT id FROM albums WHERE parent_id = ?`, [id]);
  for (const s of subs) await deleteAlbum(s.id);
  await db.runAsync(`DELETE FROM albums WHERE id = ?`, [id]);
}

export async function reorderAlbums(orderedIds) {
  const db = await getDB();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.runAsync(`UPDATE albums SET sort_order = ? WHERE id = ?`, [i, orderedIds[i]]);
  }
}

export async function getAlbumThumbnailUris(albumId) {
  const db = await getDB();
  const rows = await db.getAllAsync(
    `SELECT uri FROM photos WHERE album_id = ? ORDER BY added_at ASC LIMIT 4`, [albumId]
  );
  return rows.map(r => r.uri);
}

export async function getAlbumPhotoCount(albumId) {
  const db = await getDB();
  const row = await db.getFirstAsync(
    `SELECT COUNT(*) AS n FROM photos WHERE album_id = ?`, [albumId]
  );
  return row?.n ?? 0;
}

// ─── Photos ───────────────────────────────────────────────────────────────────

export async function getPhotos(albumId, sortBy = 'added_at') {
  const db = await getDB();
  const [col, dir] =
    sortBy === 'taken_at' ? ['COALESCE(taken_at, added_at)', 'DESC'] :
    sortBy === 'manual'   ? ['sort_order', 'ASC'] :
                            ['added_at', 'DESC'];
  return db.getAllAsync(
    `SELECT * FROM photos WHERE album_id = ? ORDER BY ${col} ${dir}`, [albumId]
  );
}

export async function importPhoto(albumId, base64Data, meta = {}) {
  if (!base64Data) throw new Error('base64Data is null or undefined');

  const db = await getDB();
  const id = `pho_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const destUri = `${PHOTOS_DIR}${id}.jpg`;

  await FileSystem.writeAsStringAsync(destUri, base64Data, { encoding: 'base64' });

  const row = await db.getFirstAsync(
    `SELECT MAX(sort_order) AS m FROM photos WHERE album_id = ?`, [albumId]
  );
  await db.runAsync(
    `INSERT INTO photos (id, album_id, uri, width, height, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, albumId, destUri, meta.width ?? null, meta.height ?? null, (row?.m ?? -1) + 1]
  );
  return { id, uri: destUri };
}

export async function deletePhotos(ids) {
  const db = await getDB();
  for (const id of ids) {
    const row = await db.getFirstAsync(`SELECT uri FROM photos WHERE id = ?`, [id]);
    if (row) await FileSystem.deleteAsync(row.uri, { idempotent: true });
    await db.runAsync(`DELETE FROM photos WHERE id = ?`, [id]);
  }
}

export async function toggleFavorite(id) {
  const db = await getDB();
  await db.runAsync(
    `UPDATE photos SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?`,
    [id]
  );
  const row = await db.getFirstAsync(`SELECT is_favorite FROM photos WHERE id = ?`, [id]);
  return row?.is_favorite === 1;
}

export async function movePhotos(ids, targetAlbumId) {
  const db = await getDB();
  for (const id of ids) {
    await db.runAsync(`UPDATE photos SET album_id = ? WHERE id = ?`, [targetAlbumId, id]);
  }
}

export async function copyPhotos(ids, targetAlbumId) {
  const db = await getDB();
  for (const id of ids) {
    const src = await db.getFirstAsync(`SELECT * FROM photos WHERE id = ?`, [id]);
    if (!src) continue;
    const newId = `pho_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ext = src.uri.split('.').pop() || 'jpg';
    const destUri = `${PHOTOS_DIR}${newId}.${ext}`;
    await FileSystem.copyAsync({ from: src.uri, to: destUri });
    const row = await db.getFirstAsync(
      `SELECT MAX(sort_order) AS m FROM photos WHERE album_id = ?`, [targetAlbumId]
    );
    await db.runAsync(
      `INSERT INTO photos (id, album_id, uri, width, height, taken_at, is_favorite, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, targetAlbumId, destUri, src.width, src.height, src.taken_at, src.is_favorite, (row?.m ?? -1) + 1]
    );
  }
}
