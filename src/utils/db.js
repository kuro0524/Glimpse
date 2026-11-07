import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';

let _db = null;
const PHOTOS_DIR_NAME = 'glimpse_photos/';
export const TRASH_RETENTION_DAYS = 7;
export const ORPHAN_ALBUM_ID = 'alb_orphan_restored';
const ORPHAN_ALBUM_NAME = '未分類';

function photosDir() {
  return `${FileSystem.documentDirectory}${PHOTOS_DIR_NAME}`;
}

function toFilename(stored) {
  return stored.split('/').pop();
}

function resolveUri(stored) {
  return `${photosDir()}${toFilename(stored)}`;
}

export function resolveMediaUri(filename) {
  return resolveUri(filename);
}

export function getPhotosDir() {
  return photosDir();
}

async function _migrateAbsolutePaths(db) {
  const uriRows = await db.getAllAsync(`SELECT id, uri FROM photos WHERE uri LIKE '%/%'`);
  for (const row of uriRows) {
    await db.runAsync(`UPDATE photos SET uri = ? WHERE id = ?`, [toFilename(row.uri), row.id]);
  }
  const thumbRows = await db.getAllAsync(`SELECT id, thumbnail FROM photos WHERE thumbnail LIKE '%/%'`);
  for (const row of thumbRows) {
    await db.runAsync(`UPDATE photos SET thumbnail = ? WHERE id = ?`, [toFilename(row.thumbnail), row.id]);
  }
}

async function _runMigrations(db) {
  const result = await db.getFirstAsync('PRAGMA user_version');
  const version = result?.user_version ?? 0;

  if (version < 1) {
    try { await db.execAsync(`ALTER TABLE photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'photo'`); } catch (_) {}
    try { await db.execAsync(`ALTER TABLE photos ADD COLUMN duration INTEGER`); } catch (_) {}
    try { await db.execAsync(`ALTER TABLE photos ADD COLUMN thumbnail TEXT`); } catch (_) {}
    await db.execAsync(`PRAGMA user_version = 1`);
  }

  if (version < 2) {
    try { await db.execAsync(`ALTER TABLE photos ADD COLUMN deleted_at INTEGER`); } catch (_) {}
    await db.execAsync(`PRAGMA user_version = 2`);
  }
}

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
      is_favorite INTEGER DEFAULT 0,
      media_type TEXT NOT NULL DEFAULT 'photo',
      duration INTEGER,
      thumbnail TEXT,
      deleted_at INTEGER
    );
  `);
  const dir = photosDir();
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  await _migrateAbsolutePaths(_db);
  await _runMigrations(_db);
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

export async function getAllAlbumsRaw() {
  const db = await getDB();
  return db.getAllAsync(`SELECT * FROM albums ORDER BY sort_order ASC`);
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
  if (id === ORPHAN_ALBUM_ID) throw new Error('PROTECTED_ALBUM');
  const db = await getDB();
  await db.runAsync(`UPDATE albums SET name = ? WHERE id = ?`, [name, id]);
}

export async function deleteAlbum(id) {
  if (id === ORPHAN_ALBUM_ID) throw new Error('PROTECTED_ALBUM');
  const db = await getDB();
  await db.runAsync(
    `UPDATE photos SET deleted_at = ? WHERE album_id = ? AND deleted_at IS NULL`,
    [Math.floor(Date.now() / 1000), id]
  );
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
    `SELECT uri, thumbnail FROM photos WHERE album_id = ? AND deleted_at IS NULL ORDER BY added_at ASC LIMIT 4`, [albumId]
  );
  return rows.map(r => resolveUri(r.thumbnail ?? r.uri));
}

export async function getAlbumPhotoCount(albumId) {
  const db = await getDB();
  const row = await db.getFirstAsync(
    `WITH RECURSIVE sub(id) AS (
       SELECT ?
       UNION ALL
       SELECT a.id FROM albums a JOIN sub s ON a.parent_id = s.id
     )
     SELECT COUNT(*) AS n FROM photos WHERE album_id IN (SELECT id FROM sub) AND deleted_at IS NULL`,
    [albumId]
  );
  return row?.n ?? 0;
}

// ─── Photos ───────────────────────────────────────────────────────────────────

function resolveRow(r) {
  return {
    ...r,
    uri: resolveUri(r.uri),
    thumbnailUri: r.thumbnail ? resolveUri(r.thumbnail) : null,
  };
}

export async function getPhotoById(id) {
  const db = await getDB();
  const row = await db.getFirstAsync(`SELECT * FROM photos WHERE id = ?`, [id]);
  if (!row) return null;
  return resolveRow(row);
}

export async function getPhotos(albumId, sortBy = 'added_at') {
  const db = await getDB();
  const [col, dir] =
    sortBy === 'taken_at' ? ['COALESCE(taken_at, added_at)', 'DESC'] :
    sortBy === 'manual'   ? ['sort_order', 'ASC'] :
                            ['added_at', 'DESC'];
  const rows = await db.getAllAsync(
    `SELECT * FROM photos WHERE album_id = ? AND deleted_at IS NULL ORDER BY ${col} ${dir}, id DESC`, [albumId]
  );
  return rows.map(resolveRow);
}

export async function getDeletedPhotos() {
  const db = await getDB();
  const rows = await db.getAllAsync(
    `SELECT * FROM photos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC`
  );
  return rows.map(resolveRow);
}

export async function getAllPhotosRaw() {
  const db = await getDB();
  return db.getAllAsync(`SELECT * FROM photos`);
}

export async function importMedia(albumId, sourceUri, meta = {}) {
  const db = await getDB();
  const id = `med_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const srcPath = sourceUri.split('?')[0];
  const srcExt = srcPath.split('.').pop()?.toLowerCase() || (meta.mediaType === 'video' ? 'mp4' : 'jpg');
  const filename = `${id}.${srcExt}`;
  await FileSystem.copyAsync({ from: sourceUri, to: resolveUri(filename) });

  let thumbFilename = null;
  if (meta.thumbnailUri) {
    const tSrcPath = meta.thumbnailUri.split('?')[0];
    const tExt = tSrcPath.split('.').pop()?.toLowerCase() || 'jpg';
    thumbFilename = `${id}_thumb.${tExt}`;
    await FileSystem.copyAsync({ from: meta.thumbnailUri, to: resolveUri(thumbFilename) });
  }

  const row = await db.getFirstAsync(
    `SELECT MAX(sort_order) AS m FROM photos WHERE album_id = ?`, [albumId]
  );
  await db.runAsync(
    `INSERT INTO photos (id, album_id, uri, thumbnail, width, height, taken_at, added_at, sort_order, media_type, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, albumId, filename, thumbFilename, meta.width ?? null, meta.height ?? null,
     meta.takenAt ?? null, meta.addedAt ?? Math.floor(Date.now() / 1000),
     (row?.m ?? -1) + 1, meta.mediaType ?? 'photo', meta.duration ?? null]
  );
  return { id, uri: resolveUri(filename) };
}

// Legacy: kept for external callers. New code should use importMedia.
export async function importPhoto(albumId, base64Data, meta = {}) {
  if (!base64Data) throw new Error('base64Data is null or undefined');
  const db = await getDB();
  const id = `pho_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const filename = `${id}.jpg`;
  const destUri = resolveUri(filename);
  await FileSystem.writeAsStringAsync(destUri, base64Data, { encoding: 'base64' });
  const row = await db.getFirstAsync(
    `SELECT MAX(sort_order) AS m FROM photos WHERE album_id = ?`, [albumId]
  );
  await db.runAsync(
    `INSERT INTO photos (id, album_id, uri, width, height, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, albumId, filename, meta.width ?? null, meta.height ?? null, (row?.m ?? -1) + 1]
  );
  return { id, uri: destUri };
}

export async function deletePhotos(ids) {
  const db = await getDB();
  const now = Math.floor(Date.now() / 1000);
  for (const id of ids) {
    await db.runAsync(`UPDATE photos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`, [now, id]);
  }
}

// Returns the id of the album that holds photos restored from trash whose
// original album no longer exists. Created lazily on first use.
async function getOrCreateOrphanAlbum() {
  const db = await getDB();
  const existing = await db.getFirstAsync(`SELECT id FROM albums WHERE id = ?`, [ORPHAN_ALBUM_ID]);
  if (existing) return ORPHAN_ALBUM_ID;
  await db.runAsync(
    `INSERT INTO albums (id, name, parent_id, sort_order) VALUES (?, ?, NULL, 0)`,
    [ORPHAN_ALBUM_ID, ORPHAN_ALBUM_NAME]
  );
  return ORPHAN_ALBUM_ID;
}

export async function restorePhotos(ids) {
  const db = await getDB();
  for (const id of ids) {
    const photo = await db.getFirstAsync(`SELECT album_id FROM photos WHERE id = ? AND deleted_at IS NOT NULL`, [id]);
    if (!photo) continue;
    const album = await db.getFirstAsync(`SELECT id FROM albums WHERE id = ?`, [photo.album_id]);
    if (album) {
      await db.runAsync(`UPDATE photos SET deleted_at = NULL WHERE id = ?`, [id]);
    } else {
      const orphanAlbumId = await getOrCreateOrphanAlbum();
      await db.runAsync(`UPDATE photos SET deleted_at = NULL, album_id = ? WHERE id = ?`, [orphanAlbumId, id]);
    }
  }
}

export async function permanentlyDeletePhotos(ids) {
  const db = await getDB();
  for (const id of ids) {
    const row = await db.getFirstAsync(`SELECT uri, thumbnail FROM photos WHERE id = ? AND deleted_at IS NOT NULL`, [id]);
    if (row) {
      try { await FileSystem.deleteAsync(resolveUri(row.uri), { idempotent: true }); } catch (_) {}
      if (row.thumbnail) {
        try { await FileSystem.deleteAsync(resolveUri(row.thumbnail), { idempotent: true }); } catch (_) {}
      }
      await db.runAsync(`DELETE FROM photos WHERE id = ?`, [id]);
    }
  }
}

const trashChangeListeners = new Set();

// Notified whenever items are purged from trash outside of a direct user action
// on the currently mounted trash screen (e.g. the startup/foreground auto-purge).
export function onTrashChanged(listener) {
  trashChangeListeners.add(listener);
  return () => trashChangeListeners.delete(listener);
}

// Permanently deletes trash items older than TRASH_RETENTION_DAYS. Safe to call
// repeatedly (e.g. on every app launch/foreground); it's a no-op when nothing has expired.
export async function purgeExpiredTrash() {
  const db = await getDB();
  const cutoff = Math.floor(Date.now() / 1000) - TRASH_RETENTION_DAYS * 86400;
  const rows = await db.getAllAsync(
    `SELECT id FROM photos WHERE deleted_at IS NOT NULL AND deleted_at <= ?`, [cutoff]
  );
  if (rows.length === 0) return;
  await permanentlyDeletePhotos(rows.map(r => r.id));
  trashChangeListeners.forEach(fn => fn());
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
    const newId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const ext = toFilename(src.uri).split('.').pop() || 'jpg';
    const newFilename = `${newId}.${ext}`;
    await FileSystem.copyAsync({ from: resolveUri(src.uri), to: resolveUri(newFilename) });

    let newThumb = null;
    if (src.thumbnail) {
      const tExt = toFilename(src.thumbnail).split('.').pop() || 'jpg';
      newThumb = `${newId}_thumb.${tExt}`;
      await FileSystem.copyAsync({ from: resolveUri(src.thumbnail), to: resolveUri(newThumb) });
    }

    const row = await db.getFirstAsync(
      `SELECT MAX(sort_order) AS m FROM photos WHERE album_id = ?`, [targetAlbumId]
    );
    await db.runAsync(
      `INSERT INTO photos (id, album_id, uri, thumbnail, width, height, taken_at, is_favorite, sort_order, media_type, duration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, targetAlbumId, newFilename, newThumb, src.width, src.height, src.taken_at,
       src.is_favorite, (row?.m ?? -1) + 1, src.media_type ?? 'photo', src.duration ?? null]
    );
  }
}

// ─── Wipe / Restore ──────────────────────────────────────────────────────────

export async function wipeAllData() {
  const db = await getDB();
  await db.execAsync(`DELETE FROM photos; DELETE FROM albums;`);
  const dir = photosDir();
  try { await FileSystem.deleteAsync(dir, { idempotent: true }); } catch (_) {}
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
}

export async function restoreFromPayload(payload) {
  await wipeAllData();
  const db = await getDB();

  for (const album of (payload.albums ?? [])) {
    await db.runAsync(
      `INSERT OR REPLACE INTO albums (id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)`,
      [album.id, album.name, album.parent_id ?? null, album.sort_order ?? 0,
       album.created_at ?? Math.floor(Date.now() / 1000)]
    );
  }

  const dir = photosDir();
  for (const [filename, b64] of Object.entries(payload.files ?? {})) {
    await FileSystem.writeAsStringAsync(`${dir}${filename}`, b64, { encoding: 'base64' });
  }

  for (const photo of (payload.photos ?? [])) {
    await db.runAsync(
      `INSERT OR REPLACE INTO photos
       (id, album_id, uri, thumbnail, width, height, taken_at, added_at, sort_order, is_favorite, media_type, duration, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [photo.id, photo.album_id, photo.uri, photo.thumbnail ?? null,
       photo.width ?? null, photo.height ?? null, photo.taken_at ?? null,
       photo.added_at ?? Math.floor(Date.now() / 1000), photo.sort_order ?? 0,
       photo.is_favorite ?? 0, photo.media_type ?? 'photo', photo.duration ?? null,
       photo.deleted_at ?? null]
    );
  }
}
