import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { zip, unzip } from 'react-native-zip-archive';
import * as db from './db';

const EXPORT_VERSION = 2;
const MAX_DEPTH = 50;

async function collectAlbumsRecursive(albumId, visitedIds, depth) {
  if (depth > MAX_DEPTH || visitedIds.has(albumId)) return [];
  visitedIds.add(albumId);

  const dbConn = await db.getDB();
  const album = await dbConn.getFirstAsync(`SELECT * FROM albums WHERE id = ?`, [albumId]);
  if (!album) return [];

  const photos = await dbConn.getAllAsync(
    `SELECT * FROM photos WHERE album_id = ? AND deleted_at IS NULL`, [albumId]
  );
  const children = await db.getAlbums(albumId);

  const result = [{ album, photos }];
  for (const child of children) {
    const sub = await collectAlbumsRecursive(child.id, visitedIds, depth + 1);
    result.push(...sub);
  }
  return result;
}

// Export an album (and all sub-albums recursively) as a ZIP file shared via the share sheet.
// onProgress(current, total) called per file copied.
// onReadyToShare() called just before the share sheet opens — use it to close the progress modal.
export async function exportAlbum(albumId, albumName, onProgress, onReadyToShare) {
  const available = await Sharing.isAvailableAsync();
  console.log('[Export] Sharing.isAvailableAsync():', available);
  if (!available) throw new Error('このデバイスでは共有機能が利用できません');

  const photosDir = db.getPhotosDir();
  const ts = Date.now();
  const stagingDir = `${FileSystem.cacheDirectory}glimpse_export_${ts}`;
  const filesDir = `${stagingDir}/files/`;
  const safeName = albumName.replace(/[^\w　-鿿]/g, '_').slice(0, 20);
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outputZip = `${FileSystem.cacheDirectory}glimpse_${safeName}_${dateStr}.zip`;

  try {
    await FileSystem.makeDirectoryAsync(filesDir, { intermediates: true });

    const allAlbumData = await collectAlbumsRecursive(albumId, new Set(), 0);

    // Count unique files upfront for accurate progress reporting
    const seenForCount = new Set();
    let totalFiles = 0;
    for (const { photos } of allAlbumData) {
      for (const p of photos) {
        const fn = p.uri.split('/').pop();
        if (fn && !seenForCount.has(fn)) { seenForCount.add(fn); totalFiles++; }
        if (p.thumbnail) {
          const tfn = p.thumbnail.split('/').pop();
          if (tfn && !seenForCount.has(tfn)) { seenForCount.add(tfn); totalFiles++; }
        }
      }
    }

    const seenFilenames = new Set();
    let doneFiles = 0;
    const manifestAlbums = [];

    for (const { album, photos } of allAlbumData) {
      const photosMeta = [];

      for (const photo of photos) {
        const mainFn = photo.uri.split('/').pop();
        let exportFn = null;
        let exportThumbFn = null;

        if (mainFn) {
          if (!seenFilenames.has(mainFn)) {
            const src = `${photosDir}${mainFn}`;
            const info = await FileSystem.getInfoAsync(src);
            if (info.exists) {
              await FileSystem.copyAsync({ from: src, to: `${filesDir}${mainFn}` });
              seenFilenames.add(mainFn);
            }
          }
          // Only reference in manifest if the file is actually present in the ZIP
          if (seenFilenames.has(mainFn)) exportFn = mainFn;
          doneFiles++;
          if (onProgress) onProgress(doneFiles, totalFiles);
        }

        if (photo.thumbnail) {
          const thumbFn = photo.thumbnail.split('/').pop();
          if (thumbFn) {
            if (!seenFilenames.has(thumbFn)) {
              const src = `${photosDir}${thumbFn}`;
              const info = await FileSystem.getInfoAsync(src);
              if (info.exists) {
                await FileSystem.copyAsync({ from: src, to: `${filesDir}${thumbFn}` });
                seenFilenames.add(thumbFn);
              }
            }
            if (seenFilenames.has(thumbFn)) exportThumbFn = thumbFn;
            doneFiles++;
            if (onProgress) onProgress(doneFiles, totalFiles);
          }
        }

        photosMeta.push({
          filename: exportFn,
          thumbnail: exportThumbFn,
          width: photo.width,
          height: photo.height,
          taken_at: photo.taken_at,
          added_at: photo.added_at,
          sort_order: photo.sort_order,
          is_favorite: photo.is_favorite,
          media_type: photo.media_type ?? 'photo',
          duration: photo.duration ?? null,
        });
      }

      manifestAlbums.push({
        id: album.id,
        name: album.name,
        // Root album has no parent in the export; sub-albums keep their relative parent reference
        parent_id: album.id === albumId ? null : album.parent_id,
        sort_order: album.sort_order,
        photos: photosMeta,
      });
    }

    const manifest = { version: EXPORT_VERSION, rootAlbumId: albumId, albums: manifestAlbums };
    await FileSystem.writeAsStringAsync(
      `${stagingDir}/manifest.json`,
      JSON.stringify(manifest),
      { encoding: 'utf8' }
    );

    const zippedPath = await zip(stagingDir, outputZip);
    console.log('[Export] zip() returned:', zippedPath);
    const zipInfo = await FileSystem.getInfoAsync(outputZip);
    console.log('[Export] outputZip info:', JSON.stringify(zipInfo));
    if (!zipInfo.exists || zipInfo.size === 0) throw new Error('ZIPファイルの生成に失敗しました');
    try { await FileSystem.deleteAsync(stagingDir, { idempotent: true }); } catch (_) {}

    if (onReadyToShare) onReadyToShare();
    // iOS では Modal の dismiss アニメーション（約300ms）が完了する前に
    // UIActivityViewController を present しようとすると黙って無視される。
    // 500ms 待ってから shareAsync を呼ぶことで確実に共有シートを表示させる。
    await new Promise(r => setTimeout(r, 500));
    console.log('[Export] calling shareAsync:', outputZip);
    await Sharing.shareAsync(outputZip, {
      mimeType: 'application/zip',
      UTI: 'public.zip-archive',
      dialogTitle: `${albumName} をエクスポート`,
    });
  } finally {
    try { await FileSystem.deleteAsync(stagingDir, { idempotent: true }); } catch (_) {}
    try { await FileSystem.deleteAsync(outputZip, { idempotent: true }); } catch (_) {}
  }
}

// Import an album hierarchy from a Glimpse ZIP file.
// Throws Error('CORRUPT_FILE') if the file is not a valid Glimpse export.
// Partial imports are rolled back on error.
// onProgress(current, total) called per photo restored.
// Returns { albumId, albumName, photoCount }.
export async function importAlbumFromZip(fileUri, onProgress) {
  const ts = Date.now();
  const tempDir = `${FileSystem.cacheDirectory}glimpse_import_${ts}/`;
  let rootNewAlbumId = null;
  const createdAlbumIds = [];

  try {
    await FileSystem.makeDirectoryAsync(tempDir, { intermediates: true });
    await unzip(fileUri, tempDir);

    // Find manifest.json — may be at root or inside a single wrapper directory.
    // Skip macOS artifact dirs (__MACOSX) that appear when a ZIP is re-zipped on macOS.
    const SKIP_DIRS = new Set(['__MACOSX', '__pycache__']);
    let manifestPath = `${tempDir}manifest.json`;
    let filesDir = `${tempDir}files/`;
    const rootInfo = await FileSystem.getInfoAsync(manifestPath);
    if (!rootInfo.exists) {
      const entries = await FileSystem.readDirectoryAsync(tempDir);
      const sub = entries.find(e => !e.startsWith('.') && !SKIP_DIRS.has(e));
      if (sub) {
        manifestPath = `${tempDir}${sub}/manifest.json`;
        filesDir = `${tempDir}${sub}/files/`;
      }
    }

    let manifest;
    try {
      const raw = await FileSystem.readAsStringAsync(manifestPath, { encoding: 'utf8' });
      manifest = JSON.parse(raw);
    } catch (_) {
      throw new Error('CORRUPT_FILE');
    }

    if (!manifest || !Array.isArray(manifest.albums) || manifest.albums.length === 0) {
      throw new Error('CORRUPT_FILE');
    }

    const photosDir = db.getPhotosDir();
    const dbConn = await db.getDB();
    const rootAlbumId = manifest.rootAlbumId ?? manifest.albums[0].id;
    const totalPhotos = manifest.albums.reduce((s, a) => s + (a.photos?.length ?? 0), 0);
    let donePhotos = 0;

    // Process albums in manifest order (DFS ensures parents appear before children)
    const idMap = new Map(); // old album id → new album id

    for (const albumData of manifest.albums) {
      const newParentId = (albumData.parent_id && idMap.has(albumData.parent_id))
        ? idMap.get(albumData.parent_id)
        : null;

      const newAlbumId = await db.createAlbum(albumData.name, newParentId);
      idMap.set(albumData.id, newAlbumId);
      createdAlbumIds.push(newAlbumId);
      if (albumData.id === rootAlbumId) rootNewAlbumId = newAlbumId;

      for (const photoMeta of (albumData.photos ?? [])) {
        const newId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        let newFilename = null;
        if (photoMeta.filename) {
          const ext = photoMeta.filename.split('.').pop() || 'jpg';
          const candidate = `${newId}.${ext}`;
          const src = `${filesDir}${photoMeta.filename}`;
          const srcInfo = await FileSystem.getInfoAsync(src);
          if (srcInfo.exists) {
            await FileSystem.copyAsync({ from: src, to: `${photosDir}${candidate}` });
            newFilename = candidate;
          }
        }

        let newThumb = null;
        if (photoMeta.thumbnail) {
          const tExt = photoMeta.thumbnail.split('.').pop() || 'jpg';
          const tCandidate = `${newId}_thumb.${tExt}`;
          const tSrc = `${filesDir}${photoMeta.thumbnail}`;
          const tInfo = await FileSystem.getInfoAsync(tSrc);
          if (tInfo.exists) {
            await FileSystem.copyAsync({ from: tSrc, to: `${photosDir}${tCandidate}` });
            newThumb = tCandidate;
          }
        }

        if (newFilename) {
          const row = await dbConn.getFirstAsync(
            `SELECT MAX(sort_order) AS m FROM photos WHERE album_id = ?`, [newAlbumId]
          );
          await dbConn.runAsync(
            `INSERT INTO photos
             (id, album_id, uri, thumbnail, width, height, taken_at, added_at, sort_order, is_favorite, media_type, duration)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newId, newAlbumId, newFilename, newThumb,
             photoMeta.width ?? null, photoMeta.height ?? null,
             photoMeta.taken_at ?? null,
             photoMeta.added_at ?? Math.floor(Date.now() / 1000),
             (row?.m ?? -1) + 1,
             photoMeta.is_favorite ?? 0,
             photoMeta.media_type ?? 'photo',
             photoMeta.duration ?? null]
          );
        }

        donePhotos++;
        if (onProgress) onProgress(donePhotos, totalPhotos);
      }
    }

    const rootAlbumMeta = manifest.albums.find(a => a.id === rootAlbumId) ?? manifest.albums[0];
    return {
      albumId: rootNewAlbumId ?? idMap.values().next().value,
      albumName: rootAlbumMeta?.name ?? 'インポートしたアルバム',
      photoCount: donePhotos,
    };
  } catch (e) {
    // Roll back all created albums. deleteAlbum is recursive so deleting the root cascades
    // to children; subsequent calls for already-deleted children are safe no-ops.
    for (const id of createdAlbumIds) {
      try { await db.deleteAlbum(id); } catch (_) {}
    }
    throw e;
  } finally {
    try { await FileSystem.deleteAsync(tempDir, { idempotent: true }); } catch (_) {}
  }
}
