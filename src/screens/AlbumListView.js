import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  useWindowDimensions,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import * as DocumentPicker from 'expo-document-picker';
import * as db from '../utils/db';
import * as albumExport from '../utils/albumExport';
import { promptExportToPhotos } from '../utils/photosExport';
import PromptModal from '../components/PromptModal';
import ProgressModal from '../components/ProgressModal';
import LongPressMenu, { openMenu } from '../components/LongPressMenu';

const CARD_PAD = 16;
const CARD_GAP = 10;

function AlbumThumbnail({ albumId, refreshKey, cardW }) {
  const [uris, setUris] = useState([]);
  useEffect(() => {
    db.getAlbumThumbnailUris(albumId).then(setUris);
  }, [albumId, refreshKey]);

  const half = cardW / 2;
  return (
    <View style={{ width: cardW, height: cardW, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden', borderRadius: 8 }}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={{ width: half, height: half, backgroundColor: '#3A3A3C' }}>
          {uris[i] && (
            <Image source={{ uri: uris[i] }} style={{ width: half, height: half }} resizeMode="cover" />
          )}
        </View>
      ))}
    </View>
  );
}

function AlbumCard({ album, onPress, menu, refreshKey, cardW }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    db.getAlbumPhotoCount(album.id).then(setCount);
  }, [album.id, refreshKey]);

  return (
    <LongPressMenu menu={menu} style={{ width: cardW }}>
      <TouchableOpacity style={{ width: cardW }} onPress={onPress} onLongPress={() => openMenu(menu)} activeOpacity={0.8}>
        <AlbumThumbnail albumId={album.id} refreshKey={refreshKey} cardW={cardW} />
        <Text style={styles.cardName} numberOfLines={1}>{album.name}</Text>
        <Text style={styles.cardCount}>{count}件</Text>
      </TouchableOpacity>
    </LongPressMenu>
  );
}

function ReorderRow({ item, drag, isActive, refreshKey }) {
  const [uris, setUris] = useState([]);
  useEffect(() => {
    db.getAlbumThumbnailUris(item.id).then(setUris);
  }, [item.id, refreshKey]);

  return (
    <ScaleDecorator>
      <TouchableOpacity
        onLongPress={drag}
        disabled={isActive}
        style={[styles.reorderRow, isActive && styles.reorderRowActive]}
        activeOpacity={0.8}
      >
        <View style={{ width: 44, height: 44, borderRadius: 6, overflow: 'hidden', backgroundColor: '#3A3A3C', flexDirection: 'row', flexWrap: 'wrap' }}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={{ width: 22, height: 22, backgroundColor: '#3A3A3C' }}>
              {uris[i] && <Image source={{ uri: uris[i] }} style={{ width: 22, height: 22 }} resizeMode="cover" />}
            </View>
          ))}
        </View>
        <Text style={styles.reorderName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.dragHandle}>⠿</Text>
      </TouchableOpacity>
    </ScaleDecorator>
  );
}

export default function AlbumListView({ navigation }) {
  const { width: windowWidth } = useWindowDimensions();
  const NUM_COLS = windowWidth > 600 ? 4 : 2;
  const CARD_W = (windowWidth - CARD_PAD * 2 - CARD_GAP * (NUM_COLS - 1)) / NUM_COLS;

  const [albums, setAlbums] = useState([]);
  const [isReordering, setIsReordering] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [prompt, setPrompt] = useState({ visible: false, title: '', defaultValue: '', onConfirm: null });

  const [importProgress, setImportProgress] = useState({ visible: false, current: 0, total: 0 });
  const [photosExportProgress, setPhotosExportProgress] = useState({ visible: false, current: 0, total: 0 });

  const loadAlbums = useCallback(async () => {
    const data = await db.getAlbums(null);
    setAlbums(data);
  }, []);

  useFocusEffect(useCallback(() => {
    loadAlbums();
    setRefreshKey(k => k + 1);
  }, [loadAlbums]));

  useEffect(() => {
    navigation.setOptions({
      title: isReordering ? '並び替え' : 'アルバム',
      headerLeft: isReordering
        ? () => (
            <TouchableOpacity
              onPress={async () => {
                await db.reorderAlbums(albums.map(a => a.id));
                setIsReordering(false);
              }}
              style={styles.textBtn}
            >
              <Text style={styles.textBtnLabel}>完了</Text>
            </TouchableOpacity>
          )
        : () => (
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.iconBtn}>
              <Ionicons name="settings-outline" size={28} color="#EBEBF5" />
            </TouchableOpacity>
          ),
      headerRight: isReordering
        ? undefined
        : () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={handleImportPickFile} style={styles.iconBtn}>
                <Ionicons name="arrow-down-circle-outline" size={24} color="#EBEBF5" />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleNewAlbum} style={styles.iconBtn}>
                <Ionicons name="add" size={30} color="#EBEBF5" />
              </TouchableOpacity>
            </View>
          ),
    });
  }, [navigation, isReordering, albums]);

  function handleNewAlbum() {
    setPrompt({
      visible: true,
      title: '新規アルバム',
      defaultValue: '',
      onConfirm: async (name) => {
        setPrompt(p => ({ ...p, visible: false }));
        await db.createAlbum(name, null);
        loadAlbums();
      },
    });
  }

  async function handleImportPickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const fileName = asset.name ?? 'ファイル';
    const fileUri = asset.uri;

    Alert.alert(
      'アルバムをインポート',
      `「${fileName}」をインポートしますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: 'インポート', onPress: () => doImport(fileUri) },
      ]
    );
  }

  async function doImport(fileUri) {
    setImportProgress({ visible: true, current: 0, total: 0 });
    try {
      const result = await albumExport.importAlbumFromZip(
        fileUri,
        (current, total) => setImportProgress({ visible: true, current, total })
      );
      setImportProgress({ visible: false, current: 0, total: 0 });
      Alert.alert(
        'インポート完了',
        `「${result.albumName}」を${result.photoCount}件の写真・動画でインポートしました。`
      );
      loadAlbums();
      setRefreshKey(k => k + 1);
    } catch (e) {
      setImportProgress({ visible: false, current: 0, total: 0 });
      if (e.message === 'CORRUPT_FILE') {
        Alert.alert('ファイルが無効です', '有効なGlimpse ZIPファイルを選択してください。');
      } else {
        Alert.alert('エラー', `インポートに失敗しました。\n${e?.message ?? String(e)}`);
      }
    }
  }

  // アルバムを長押ししたときのメニュー
  function buildAlbumMenu(album) {
    const isProtected = album.id === db.ORPHAN_ALBUM_ID;
    const actions = [
      { id: 'export', title: '写真アプリに書き出し', image: 'square.and.arrow.down' },
      ...(isProtected ? [] : [{ id: 'rename', title: '名前を変更', image: 'pencil' }]),
      { id: 'newSub', title: 'サブアルバムを作成', image: 'folder.badge.plus' },
      { id: 'reorder', title: '並び替え', image: 'arrow.up.arrow.down' },
      ...(isProtected ? [] : [{ id: 'delete', title: '削除', image: 'trash', destructive: true }]),
    ];
    return {
      title: album.name,
      actions,
      onAction: (id) => {
        if (id === 'export') promptExportToPhotos(album, setPhotosExportProgress);
        if (id === 'rename') handleRename(album);
        if (id === 'newSub') handleNewSub(album);
        if (id === 'reorder') setIsReordering(true);
        if (id === 'delete') handleDelete(album);
      },
    };
  }

  function handleRename(album) {
    setPrompt({
      visible: true,
      title: 'アルバム名を変更',
      defaultValue: album.name,
      onConfirm: async (name) => {
        setPrompt(p => ({ ...p, visible: false }));
        try {
          await db.renameAlbum(album.id, name);
          loadAlbums();
        } catch (e) {
          Alert.alert('変更できません', '「未分類」の名前は変更できません。');
        }
      },
    });
  }

  function handleNewSub(album) {
    setPrompt({
      visible: true,
      title: `「${album.name}」のサブアルバム`,
      defaultValue: '',
      onConfirm: async (name) => {
        setPrompt(p => ({ ...p, visible: false }));
        await db.createAlbum(name, album.id);
        loadAlbums();
      },
    });
  }

  async function handleDelete(album) {
    Alert.alert('アルバムを削除', `「${album.name}」とすべての写真・動画を削除しますか？`, [
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          try {
            await db.deleteAlbum(album.id);
            loadAlbums();
          } catch (e) {
            Alert.alert('削除できません', '「未分類」は削除できません。');
          }
        },
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.container}>
      {isReordering ? (
        <DraggableFlatList
          data={albums}
          onDragEnd={({ data }) => setAlbums(data)}
          keyExtractor={a => a.id}
          contentContainerStyle={styles.reorderList}
          renderItem={({ item, drag, isActive }) => (
            <ReorderRow item={item} drag={drag} isActive={isActive} refreshKey={refreshKey} />
          )}
        />
      ) : (
        <FlatList
          key={NUM_COLS}
          data={albums}
          keyExtractor={a => a.id}
          numColumns={NUM_COLS}
          contentContainerStyle={[styles.grid, { padding: CARD_PAD, gap: CARD_GAP }]}
          columnWrapperStyle={NUM_COLS > 1 ? { gap: CARD_GAP } : undefined}
          renderItem={({ item }) => (
            <AlbumCard
              key={`${item.id}-${refreshKey}`}
              album={item}
              cardW={CARD_W}
              refreshKey={refreshKey}
              onPress={() => navigation.navigate('AlbumDetail', { albumId: item.id, albumName: item.name })}
              menu={buildAlbumMenu(item)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>アルバムがありません</Text>
              <Text style={styles.emptyHint}>+ をタップして作成</Text>
            </View>
          }
        />
      )}

      <ProgressModal
        visible={importProgress.visible}
        title="インポート中…"
        current={importProgress.current}
        total={importProgress.total}
      />
      <ProgressModal
        visible={photosExportProgress.visible}
        title="写真アプリに書き出し中…"
        current={photosExportProgress.current}
        total={photosExportProgress.total}
      />

      <PromptModal
        visible={prompt.visible}
        title={prompt.title}
        defaultValue={prompt.defaultValue}
        onConfirm={prompt.onConfirm ?? (() => {})}
        onCancel={() => setPrompt(p => ({ ...p, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: {
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  textBtnLabel: {
    color: '#EBEBF5',
    fontSize: 16,
  },
  grid: {},
  cardName: {
    color: '#EBEBF5',
    fontSize: 13,
    marginTop: 6,
    fontWeight: '400',
  },
  cardCount: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
  },
  reorderList: {
    padding: 16,
    gap: 2,
  },
  reorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C2C2E',
    padding: 12,
    borderRadius: 10,
    gap: 12,
  },
  reorderRowActive: {
    backgroundColor: '#3A3A3C',
  },
  reorderName: {
    flex: 1,
    color: '#EBEBF5',
    fontSize: 15,
  },
  dragHandle: {
    color: '#636366',
    fontSize: 20,
  },
  empty: {
    alignItems: 'center',
    marginTop: 80,
  },
  emptyText: {
    color: '#8E8E93',
    fontSize: 17,
    marginBottom: 8,
  },
  emptyHint: {
    color: '#636366',
    fontSize: 13,
  },
});
