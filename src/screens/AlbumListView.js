import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import * as db from '../utils/db';
import PromptModal from '../components/PromptModal';

const SCREEN_W = Dimensions.get('window').width;
const CARD_PAD = 16;
const CARD_GAP = 10;
const CARD_W = (SCREEN_W - CARD_PAD * 2 - CARD_GAP) / 2;

function AlbumThumbnail({ albumId, refreshKey }) {
  const [uris, setUris] = useState([]);
  useEffect(() => {
    db.getAlbumThumbnailUris(albumId).then(setUris);
  }, [albumId, refreshKey]);

  const half = CARD_W / 2;
  return (
    <View style={{ width: CARD_W, height: CARD_W, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden', borderRadius: 8 }}>
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

function AlbumCard({ album, onPress, onLongPress, refreshKey }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    db.getAlbumPhotoCount(album.id).then(setCount);
  }, [album.id, refreshKey]);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.8}>
      <AlbumThumbnail albumId={album.id} refreshKey={refreshKey} />
      <Text style={styles.cardName} numberOfLines={1}>{album.name}</Text>
      <Text style={styles.cardCount}>{count}枚</Text>
    </TouchableOpacity>
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
  const [albums, setAlbums] = useState([]);
  const [isReordering, setIsReordering] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [prompt, setPrompt] = useState({ visible: false, title: '', defaultValue: '', onConfirm: null });

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
            <TouchableOpacity onPress={handleNewAlbum} style={styles.iconBtn}>
              <Ionicons name="add" size={30} color="#EBEBF5" />
            </TouchableOpacity>
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

  function showAlbumMenu(album) {
    Alert.alert(album.name, '', [
      { text: '名前を変更', onPress: () => handleRename(album) },
      { text: 'サブアルバムを作成', onPress: () => handleNewSub(album) },
      { text: '並び替え', onPress: () => setIsReordering(true) },
      { text: '削除', style: 'destructive', onPress: () => handleDelete(album) },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  }

  function handleRename(album) {
    setPrompt({
      visible: true,
      title: 'アルバム名を変更',
      defaultValue: album.name,
      onConfirm: async (name) => {
        setPrompt(p => ({ ...p, visible: false }));
        await db.renameAlbum(album.id, name);
        loadAlbums();
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
    Alert.alert('アルバムを削除', `「${album.name}」とすべての写真を削除しますか？`, [
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await db.deleteAlbum(album.id);
          loadAlbums();
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
          data={albums}
          keyExtractor={a => a.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: CARD_GAP }}
          renderItem={({ item }) => (
            <AlbumCard
              key={`${item.id}-${refreshKey}`}
              album={item}
              refreshKey={refreshKey}
              onPress={() => navigation.navigate('AlbumDetail', { albumId: item.id, albumName: item.name })}
              onLongPress={() => showAlbumMenu(item)}
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
  grid: {
    padding: CARD_PAD,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_W,
  },
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
