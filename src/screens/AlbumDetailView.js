import React, { useState, useCallback, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as db from '../utils/db';
import PromptModal from '../components/PromptModal';
import AlbumPickerModal from '../components/AlbumPickerModal';

const SCREEN_W = Dimensions.get('window').width;
const CELL_GAP = 2;
const CELL_W = (SCREEN_W - CELL_GAP * 2) / 3;

function PhotoCell({ photo, isSelecting, isSelected, onPress, onLongPress }) {
  return (
    <TouchableOpacity
      style={styles.cell}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      delayLongPress={350}
    >
      <Image source={{ uri: photo.uri }} style={styles.cellImage} resizeMode="contain" />
      {photo.is_favorite === 1 && (
        <View style={styles.favoriteIndicator}>
          <Ionicons name="heart" size={10} color="#FF453A" />
        </View>
      )}
      {isSelecting && (
        <View style={[styles.selectOverlay, isSelected && styles.selectOverlayActive]}>
          {isSelected && (
            <View style={styles.checkCircle}>
              <Ionicons name="checkmark" size={14} color="#fff" />
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

function SubAlbumCard({ album, onPress, onLongPress }) {
  const [uris, setUris] = useState([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    db.getAlbumThumbnailUris(album.id).then(setUris);
    db.getAlbumPhotoCount(album.id).then(setCount);
  }, [album.id]);

  return (
    <TouchableOpacity style={styles.subCard} onPress={onPress} onLongPress={onLongPress} activeOpacity={0.8}>
      <View style={{ width: 88, height: 88, flexDirection: 'row', flexWrap: 'wrap', borderRadius: 8, overflow: 'hidden', backgroundColor: '#3A3A3C' }}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={{ width: 44, height: 44, backgroundColor: '#3A3A3C' }}>
            {uris[i] && <Image source={{ uri: uris[i] }} style={{ width: 44, height: 44 }} resizeMode="cover" />}
          </View>
        ))}
      </View>
      <Text style={styles.subCardName} numberOfLines={1}>{album.name}</Text>
      <Text style={styles.subCardCount}>{count}枚</Text>
    </TouchableOpacity>
  );
}

export default function AlbumDetailView({ navigation, route }) {
  const { albumId, albumName } = route.params;
  const [photos, setPhotos] = useState([]);
  const [subAlbums, setSubAlbums] = useState([]);
  const [sortMode, setSortMode] = useState('added_at');
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerAction, setPickerAction] = useState(null);
  const [prompt, setPrompt] = useState({ visible: false, title: '', defaultValue: '', onConfirm: null });
  const insets = useSafeAreaInsets();

  const loadData = useCallback(async () => {
    const [p, s] = await Promise.all([
      db.getPhotos(albumId, sortMode),
      db.getAlbums(albumId),
    ]);
    setPhotos(p);
    setSubAlbums(s);
  }, [albumId, sortMode]);

  useFocusEffect(useCallback(() => {
    loadData();
  }, [loadData]));

  useLayoutEffect(() => {
    if (isSelecting) {
      navigation.setOptions({
        title: selectedIds.size > 0 ? `${selectedIds.size}枚選択` : '写真を選択',
        headerLeft: () => (
          <TouchableOpacity onPress={cancelSelect} style={styles.textBtn}>
            <Text style={styles.textBtnLabel}>キャンセル</Text>
          </TouchableOpacity>
        ),
        headerRight: undefined,
      });
    } else {
      navigation.setOptions({
        title: albumName,
        headerLeft: undefined,
        headerRight: () => (
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => setIsSelecting(true)} style={styles.textBtn}>
              <Text style={styles.textBtnLabel}>選択</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={showAddMenu} style={styles.iconBtn}>
              <Ionicons name="add" size={30} color="#EBEBF5" />
            </TouchableOpacity>
          </View>
        ),
      });
    }
  }, [navigation, albumName, isSelecting, selectedIds.size]);

  function cancelSelect() {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function showSortPicker() {
    const opts = ['キャンセル', '追加日', '撮影日', '手動'];
    const modes = [null, 'added_at', 'taken_at', 'manual'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: opts, cancelButtonIndex: 0, title: '並び順' },
        (i) => { if (i > 0) setSortMode(modes[i]); }
      );
    } else {
      Alert.alert('並び順', '', [
        { text: '追加日', onPress: () => setSortMode('added_at') },
        { text: '撮影日', onPress: () => setSortMode('taken_at') },
        { text: '手動', onPress: () => setSortMode('manual') },
        { text: 'キャンセル', style: 'cancel' },
      ]);
    }
  }

  function showAddMenu() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['キャンセル', '写真を追加', 'サブアルバムを作成', '並び順を変更'], cancelButtonIndex: 0 },
        (i) => {
          if (i === 1) handleImport();
          if (i === 2) handleNewSubAlbum();
          if (i === 3) showSortPicker();
        }
      );
    } else {
      Alert.alert('', '', [
        { text: '写真を追加', onPress: handleImport },
        { text: 'サブアルバムを作成', onPress: handleNewSubAlbum },
        { text: '並び順を変更', onPress: showSortPicker },
        { text: 'キャンセル', style: 'cancel' },
      ]);
    }
  }

  async function handleImport() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted' && status !== 'limited') {
      Alert.alert('アクセス許可が必要', '設定アプリでフォトライブラリへのアクセスを許可してください。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      base64: true,
      quality: 0.8,
    });
    if (result.canceled) return;

    setImporting(true);
    try {
      for (const asset of result.assets) {
        if (!asset.base64) continue;
        await db.importPhoto(albumId, asset.base64, { width: asset.width, height: asset.height });
      }
      await loadData();
    } catch (e) {
      Alert.alert('エラー', `インポートに失敗しました。\n${e?.message ?? String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  function handleNewSubAlbum() {
    setPrompt({
      visible: true,
      title: 'サブアルバムを作成',
      defaultValue: '',
      onConfirm: async (name) => {
        setPrompt(p => ({ ...p, visible: false }));
        await db.createAlbum(name, albumId);
        await loadData();
      },
    });
  }

  function showSubAlbumMenu(album) {
    Alert.alert(album.name, '', [
      {
        text: '名前を変更',
        onPress: () => setPrompt({
          visible: true,
          title: 'アルバム名を変更',
          defaultValue: album.name,
          onConfirm: async (name) => {
            setPrompt(p => ({ ...p, visible: false }));
            await db.renameAlbum(album.id, name);
            await loadData();
          },
        }),
      },
      {
        text: '削除',
        style: 'destructive',
        onPress: () =>
          Alert.alert('アルバムを削除', `「${album.name}」とすべての写真を削除しますか？`, [
            {
              text: '削除',
              style: 'destructive',
              onPress: async () => {
                await db.deleteAlbum(album.id);
                await loadData();
              },
            },
            { text: 'キャンセル', style: 'cancel' },
          ]),
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  }

  async function handleDeleteSelected() {
    if (selectedIds.size === 0) return;
    Alert.alert('写真を削除', `${selectedIds.size}枚の写真を削除しますか？`, [
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await db.deletePhotos([...selectedIds]);
          cancelSelect();
          await loadData();
        },
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  }

  async function handlePickerSelect(targetAlbum) {
    setPickerVisible(false);
    if (pickerAction === 'move') {
      await db.movePhotos([...selectedIds], targetAlbum.id);
    } else {
      await db.copyPhotos([...selectedIds], targetAlbum.id);
    }
    cancelSelect();
    await loadData();
  }

  const hasSelection = selectedIds.size > 0;

  return (
    <View style={styles.container}>
      {importing && (
        <View style={styles.importingBanner}>
          <ActivityIndicator size="small" color="#EBEBF5" />
          <Text style={styles.importingText}>インポート中…</Text>
        </View>
      )}

      <FlatList
        data={photos}
        keyExtractor={p => p.id}
        numColumns={3}
        contentContainerStyle={styles.photoGrid}
        columnWrapperStyle={{ gap: CELL_GAP }}
        ListHeaderComponent={subAlbums.length > 0 ? (
          <View style={styles.subSection}>
            <Text style={styles.subSectionTitle}>サブアルバム</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subList}>
              {subAlbums.map(sa => (
                <SubAlbumCard
                  key={sa.id}
                  album={sa}
                  onPress={() => navigation.push('AlbumDetail', { albumId: sa.id, albumName: sa.name })}
                  onLongPress={() => showSubAlbumMenu(sa)}
                />
              ))}
            </ScrollView>
            <View style={styles.divider} />
          </View>
        ) : null}
        renderItem={({ item, index }) => (
          <PhotoCell
            photo={item}
            isSelecting={isSelecting}
            isSelected={selectedIds.has(item.id)}
            onPress={() => {
              if (isSelecting) {
                toggleSelect(item.id);
              } else {
                navigation.navigate('PhotoViewer', { albumId, initialIndex: index, sortMode });
              }
            }}
            onLongPress={() => {
              if (!isSelecting) {
                setIsSelecting(true);
                setSelectedIds(new Set([item.id]));
              }
            }}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>写真がありません</Text>
            <Text style={styles.emptyHint}>+ をタップして追加</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: CELL_GAP }} />}
      />

      {isSelecting && (
        <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={handleDeleteSelected}
            disabled={!hasSelection}
          >
            <Ionicons name="trash-outline" size={24} color={hasSelection ? '#FF453A' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#FF453A' : '#636366' }]}>削除</Text>
          </TouchableOpacity>
          <View style={styles.actionSep} />
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => { if (hasSelection) { setPickerAction('move'); setPickerVisible(true); } }}
            disabled={!hasSelection}
          >
            <Ionicons name="folder-outline" size={24} color={hasSelection ? '#EBEBF5' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#EBEBF5' : '#636366' }]}>移動</Text>
          </TouchableOpacity>
          <View style={styles.actionSep} />
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => { if (hasSelection) { setPickerAction('copy'); setPickerVisible(true); } }}
            disabled={!hasSelection}
          >
            <Ionicons name="copy-outline" size={24} color={hasSelection ? '#EBEBF5' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#EBEBF5' : '#636366' }]}>コピー</Text>
          </TouchableOpacity>
        </View>
      )}

      <PromptModal
        visible={prompt.visible}
        title={prompt.title}
        defaultValue={prompt.defaultValue}
        onConfirm={prompt.onConfirm ?? (() => {})}
        onCancel={() => setPrompt(p => ({ ...p, visible: false }))}
      />

      <AlbumPickerModal
        visible={pickerVisible}
        excludeId={albumId}
        onPick={handlePickerSelect}
        onCancel={() => setPickerVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
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
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  importingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: '#2C2C2E',
  },
  importingText: {
    color: '#8E8E93',
    fontSize: 13,
  },
  subSection: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  subSectionTitle: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subList: {
    paddingHorizontal: 12,
    gap: 10,
  },
  subCard: {
    width: 96,
  },
  subCardName: {
    color: '#EBEBF5',
    fontSize: 12,
    marginTop: 6,
  },
  subCardCount: {
    color: '#8E8E93',
    fontSize: 11,
    marginTop: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#3A3A3C',
    marginTop: 12,
  },
  photoGrid: {
    paddingBottom: 8,
  },
  cell: {
    width: CELL_W,
    height: CELL_W,
    backgroundColor: '#2C2C2E',
  },
  cellImage: {
    width: CELL_W,
    height: CELL_W,
  },
  favoriteIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  selectOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: 4,
  },
  selectOverlayActive: {
    backgroundColor: 'rgba(235,235,245,0.20)',
    borderColor: '#0A84FF',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C2C2E',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A3A3C',
    paddingTop: 4,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 4,
  },
  actionBtnText: {
    fontSize: 11,
    fontWeight: '500',
  },
  actionSep: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: '#3A3A3C',
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
