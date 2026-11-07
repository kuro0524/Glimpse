// アルバムの写真・動画を、iOSの写真アプリに書き出す。
// サブアルバムの中身も含めて、まとめて書き出す（ゴミ箱の項目は除く）。
import { Alert } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as db from './db';

async function collectItems(albumId, visited = new Set(), depth = 0) {
  if (depth > 50 || visited.has(albumId)) return [];
  visited.add(albumId);
  const conn = await db.getDB();
  const photos = await conn.getAllAsync(
    `SELECT uri FROM photos WHERE album_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`,
    [albumId]
  );
  const items = photos.map(p => p.uri).filter(Boolean);
  const children = await db.getAlbums(albumId);
  for (const child of children) {
    items.push(...(await collectItems(child.id, visited, depth + 1)));
  }
  return items;
}

function toFileUri(stored) {
  // DBには相対パス（ファイル名）で保存されている
  const filename = stored.split('/').pop();
  return `${db.getPhotosDir()}${filename}`;
}

// 写真アプリに同じ名前のアルバムがあれば「名前 (2)」「名前 (3)」…にする
async function uniqueAlbumName(name) {
  if (!(await MediaLibrary.getAlbumAsync(name))) return name;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${name} (${n})`;
    if (!(await MediaLibrary.getAlbumAsync(candidate))) return candidate;
  }
  return `${name} (${Date.now()})`;
}

// mode: 'cameraRoll' | 'album'
export async function exportAlbumToPhotos(albumId, albumName, mode, onProgress) {
  const files = await collectItems(albumId);
  if (files.length === 0) return { count: 0 };

  const assets = [];
  for (let i = 0; i < files.length; i++) {
    assets.push(await MediaLibrary.createAssetAsync(toFileUri(files[i])));
    onProgress?.(i + 1, files.length);
  }

  let photosAlbumName = null;
  if (mode === 'album') {
    photosAlbumName = await uniqueAlbumName(albumName);
    const [first, ...rest] = assets;
    const created = await MediaLibrary.createAlbumAsync(photosAlbumName, first, false);
    if (rest.length > 0) await MediaLibrary.addAssetsToAlbumAsync(rest, created, false);
  }
  return { count: assets.length, photosAlbumName };
}

async function ensurePermission(mode) {
  // アルバムを作るには写真ライブラリのフルアクセスが必要。保存だけなら追加のみで足りる
  const perm = await MediaLibrary.requestPermissionsAsync(mode === 'cameraRoll');
  if (perm.status !== 'granted') return false;
  if (mode === 'album' && perm.accessPrivileges && perm.accessPrivileges !== 'all') return false;
  return true;
}

// メニューから呼ぶ。保存先を選んでもらい、書き出す。
// setProgress({ visible, current, total }) で進捗表示を出す。
export function promptExportToPhotos(album, setProgress) {
  const run = async (mode) => {
    if (!(await ensurePermission(mode))) {
      Alert.alert(
        'アクセス許可が必要',
        mode === 'album'
          ? 'アルバムを作るには、設定アプリでGlimpseの写真へのアクセスを「フルアクセス」にしてください。'
          : '設定アプリでフォトライブラリへの書き込みを許可してください。'
      );
      return;
    }
    setProgress({ visible: true, current: 0, total: 0 });
    try {
      const result = await exportAlbumToPhotos(album.id, album.name, mode,
        (current, total) => setProgress({ visible: true, current, total }));
      setProgress({ visible: false, current: 0, total: 0 });
      if (result.count === 0) {
        Alert.alert('書き出す項目がありません', `「${album.name}」には写真・動画がありません。`);
      } else if (mode === 'album') {
        Alert.alert('書き出し完了', `写真アプリにアルバム「${result.photosAlbumName}」を作り、${result.count}件を保存しました。`);
      } else {
        Alert.alert('書き出し完了', `${result.count}件をカメラロールに保存しました。`);
      }
    } catch (e) {
      setProgress({ visible: false, current: 0, total: 0 });
      Alert.alert('エラー', `書き出しに失敗しました。\n${e?.message ?? String(e)}`);
    }
  };

  Alert.alert(`「${album.name}」を書き出し`, '写真アプリへの保存方法を選んでください。', [
    { text: 'カメラロールに保存', onPress: () => run('cameraRoll') },
    { text: 'アルバムを作って保存', onPress: () => run('album') },
    { text: 'キャンセル', style: 'cancel' },
  ]);
}
