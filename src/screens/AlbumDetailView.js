import React, { useState, useCallback, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  Animated,
  useWindowDimensions,
  StyleSheet,
  ScrollView,
  Platform,
  ActionSheetIOS,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as db from '../utils/db';
import * as albumExport from '../utils/albumExport';
import PromptModal from '../components/PromptModal';
import AlbumPickerModal from '../components/AlbumPickerModal';
import ProgressModal from '../components/ProgressModal';
import { promptExportToPhotos } from '../utils/photosExport';

const CELL_GAP = 2;
const SECTION_HEADER_HEIGHT = 36; // paddingTop:16 + fontSize:13 (~lineHeight:8) + paddingBottom:6

function formatDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function groupPhotosByDate(photos, dateField) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const todayMs = d.getTime();
  const yesterdayMs = todayMs - 86400000;
  const thisWeekMs = todayMs - 7 * 86400000;
  const monthStartMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

  const buckets = { today: [], yesterday: [], thisWeek: [], thisMonth: [] };
  const monthlyBuckets = new Map(); // "year-month" → { year, month, items }
  for (const p of photos) {
    const ts = (p[dateField] ?? p.added_at) * 1000;
    if (ts >= todayMs) buckets.today.push(p);
    else if (ts >= yesterdayMs) buckets.yesterday.push(p);
    else if (ts >= thisWeekMs) buckets.thisWeek.push(p);
    else if (ts >= monthStartMs) buckets.thisMonth.push(p);
    else {
      const dt = new Date(ts);
      const year = dt.getFullYear();
      const month = dt.getMonth();
      const key = `${year}-${month}`;
      if (!monthlyBuckets.has(key)) monthlyBuckets.set(key, { year, month, items: [] });
      monthlyBuckets.get(key).items.push(p);
    }
  }

  const monthlySections = [...monthlyBuckets.values()]
    .sort((a, b) => (b.year - a.year) || (b.month - a.month))
    .map(({ year, month, items }) => ({ label: `${year}年${month + 1}月`, items }));

  return [
    { label: '今日', items: buckets.today },
    { label: '昨日', items: buckets.yesterday },
    { label: '今週', items: buckets.thisWeek },
    { label: '今月', items: buckets.thisMonth },
    ...monthlySections,
  ].filter(s => s.items.length > 0);
}

// 縦方向のなぞり選択を始めるまでに指を止める時間
const HOLD_TO_DRAG_MS = 220;

function MediaCellInner({ photo, isSelecting, isSelected, onPress, onLongPress, cellW }) {
  const [broken, setBroken] = useState(false);
  const isVideo = photo.media_type === 'video';
  const displayUri = photo.thumbnailUri ?? photo.uri;

  return (
    <TouchableOpacity
      style={[styles.cellBase, { width: cellW, height: cellW }]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      delayLongPress={350}
    >
      <Image
        source={{ uri: displayUri }}
        style={{ width: cellW, height: cellW }}
        resizeMode="cover"
        onError={() => setBroken(true)}
      />
      {broken && (
        <View style={styles.brokenOverlay}>
          <Ionicons name={isVideo ? 'videocam-outline' : 'image-outline'} size={22} color="#636366" />
          <Text style={styles.brokenText}>読み込み不可</Text>
        </View>
      )}
      {!broken && isVideo && (
        <>
          <View style={styles.videoBadgePlay}>
            <Ionicons name="play" size={10} color="#fff" />
          </View>
          {!!photo.duration && (
            <View style={styles.videoBadgeDuration}>
              <Text style={styles.videoDurationText}>{formatDuration(photo.duration)}</Text>
            </View>
          )}
        </>
      )}
      {!broken && !isVideo && photo.is_favorite === 1 && (
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

// 選択状態が変わったセルだけ再描画して、なぞり選択を軽くする
const MediaCell = React.memo(MediaCellInner, (prev, next) =>
    prev.photo === next.photo &&
    prev.isSelecting === next.isSelecting &&
    prev.isSelected === next.isSelected &&
    prev.cellW === next.cellW
);

function SubAlbumCard({ album, onPress, onLongPress, refreshKey }) {
  const [uris, setUris] = useState([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    db.getAlbumThumbnailUris(album.id).then(setUris);
    db.getAlbumPhotoCount(album.id).then(setCount);
  }, [album.id, refreshKey]);

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
      <Text style={styles.subCardCount}>{count}件</Text>
    </TouchableOpacity>
  );
}

async function getCreationTime(assetId) {
  if (!assetId) return null;
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    return info?.creationTime ? Math.floor(info.creationTime / 1000) : null;
  } catch (_) {
    return null;
  }
}

export default function AlbumDetailView({ navigation, route }) {
  const { albumId, albumName } = route.params;
  const { width: windowWidth } = useWindowDimensions();
  const NUM_COLS = windowWidth > 600 ? 5 : 3;
  const CELL_W = (windowWidth - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS;

  const [photos, setPhotos] = useState([]);
  const [subAlbums, setSubAlbums] = useState([]);
  const [sortMode, setSortMode] = useState('added_at');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pickerVisible, setPickerVisible] = useState(false);
  const [prompt, setPrompt] = useState({ visible: false, title: '', defaultValue: '', onConfirm: null });
  const [toastMessage, setToastMessage] = useState('');
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  const [importProgress, setImportProgress] = useState({ visible: false, current: 0, total: 0 });
  const [deleteProgress, setDeleteProgress] = useState({ visible: false, current: 0, total: 0 });
  const [exportProgress, setExportProgress] = useState({ visible: false, current: 0, total: 0 });
  const [photosExportProgress, setPhotosExportProgress] = useState({ visible: false, current: 0, total: 0 });

  // ── drag-to-select (manual mode only) ────────────────────────────────────
  const containerRef = useRef(null);
  const flatListRef = useRef(null);
  const scrollOffsetRef = useRef(0);
  const headerHeightRef = useRef(0);
  const containerTopRef = useRef(0);
  const containerLeftRef = useRef(0);
  const containerHeightRef = useRef(0);
  const numColsRef = useRef(NUM_COLS);
  const cellWRef = useRef(CELL_W);

  const isSelectingRef = useRef(false);
  const selectedIdsRef = useRef(new Set());
  const photosRef = useRef([]);
  const sortModeRef = useRef('added_at');

  const dragActiveRef = useRef(false);
  const dragModeRef = useRef('select');
  const dragStartIdxRef = useRef(-1);
  const lastCellIdxRef = useRef(-1);
  const initSelectedRef = useRef(new Set());
  const lastPageXRef = useRef(0);
  const lastPageYRef = useRef(0);
  const autoScrollTimerRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchDownTimeRef = useRef(0);
  const isExportingRef = useRef(false);
  const cellYOffsetsRef = useRef([]);
  const containerWidthRef = useRef(0);
  const photoFlatIndexRef = useRef(new Map());
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => { isSelectingRef.current = isSelecting; }, [isSelecting]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => { sortModeRef.current = sortMode; }, [sortMode]);
  useEffect(() => { if (subAlbums.length === 0) headerHeightRef.current = 0; }, [subAlbums.length]);
  useEffect(() => {
    numColsRef.current = NUM_COLS;
    cellWRef.current = CELL_W;
  }, [NUM_COLS, CELL_W]);

  // Build display rows (section headers + photo rows)
  const displayData = useMemo(() => {
    const isGrouped = sortMode !== 'manual';
    if (!isGrouped) {
      const rows = [];
      for (let i = 0; i < photos.length; i += NUM_COLS) {
        rows.push({ type: 'row', photos: photos.slice(i, i + NUM_COLS) });
      }
      return rows;
    }
    const dateField = sortMode === 'taken_at' ? 'taken_at' : 'added_at';
    const sections = groupPhotosByDate(photos, dateField);
    const rows = [];
    for (const section of sections) {
      rows.push({ type: 'header', label: section.label });
      for (let i = 0; i < section.items.length; i += NUM_COLS) {
        rows.push({ type: 'row', photos: section.items.slice(i, i + NUM_COLS) });
      }
    }
    return rows;
  }, [photos, sortMode, NUM_COLS]);

  // Map photo id → flat index for navigation
  const photoFlatIndex = useMemo(() => {
    const map = new Map();
    photos.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [photos]);

  useEffect(() => { photoFlatIndexRef.current = photoFlatIndex; }, [photoFlatIndex]);

  // Precompute cumulative y-offsets for each displayData row for calculation-based hit testing
  useEffect(() => {
    let y = 0;
    cellYOffsetsRef.current = displayData.map(item => {
      const entry = { type: item.type, y, photos: item.photos ?? [] };
      y += (item.type === 'header' ? SECTION_HEADER_HEIGHT : CELL_W) + CELL_GAP;
      return entry;
    });
  }, [displayData, CELL_W]);

  // ── drag-to-select helpers ────────────────────────────────────────────────
  const getCellIndex = useCallback((pageX, pageY) => {
    const nc = numColsRef.current;
    const cw = cellWRef.current;
    const containerLeft = containerLeftRef.current;
    const containerWidth = containerWidthRef.current || (cw * nc + CELL_GAP * (nc - 1));

    const localX = pageX - containerLeft;
    const localY = pageY - containerTopRef.current + scrollOffsetRef.current - headerHeightRef.current;

    if (localX < 0 || localX >= containerWidth || localY < 0) return -1;

    const col = Math.min(Math.floor(localX * nc / containerWidth), nc - 1);
    const offsets = cellYOffsetsRef.current;
    for (let i = 0; i < offsets.length; i++) {
      const item = offsets[i];
      if (item.type !== 'row') continue;
      if (localY >= item.y && localY < item.y + cw + CELL_GAP) {
        if (col >= item.photos.length) return -1;
        return photoFlatIndexRef.current.get(item.photos[col].id) ?? -1;
      }
    }
    return -1;
  }, []);

  const applyRangeSelection = useCallback((startIdx, endIdx) => {
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const ps = photosRef.current;
    const next = new Set(initSelectedRef.current);
    for (let i = lo; i <= hi; i++) {
      if (i < ps.length) {
        const id = ps[i].id;
        dragModeRef.current === 'select' ? next.add(id) : next.delete(id);
      }
    }
    setSelectedIds(next);
  }, []);

  const updateSelectionAtPoint = useCallback((pageX, pageY) => {
    const idx = getCellIndex(pageX, pageY);
    if (idx !== -1 && idx !== lastCellIdxRef.current) {
      lastCellIdxRef.current = idx;
      applyRangeSelection(dragStartIdxRef.current, idx);
    }
  }, [getCellIndex, applyRangeSelection]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimerRef.current) {
      clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
  }, []);

  const startAutoScrollIfNeeded = useCallback((pageY) => {
    stopAutoScroll();
    const EDGE = 80;
    const top = containerTopRef.current;
    const bottom = top + containerHeightRef.current;
    if (pageY < top + EDGE) {
      const speed = Math.max(2, ((EDGE - (pageY - top)) / EDGE) * 14);
      autoScrollTimerRef.current = setInterval(() => {
        const next = Math.max(0, scrollOffsetRef.current - speed);
        flatListRef.current?.scrollToOffset({ offset: next, animated: false });
        updateSelectionAtPoint(lastPageXRef.current, lastPageYRef.current);
      }, 16);
    } else if (pageY > bottom - EDGE) {
      const speed = Math.max(2, ((EDGE - (bottom - pageY)) / EDGE) * 14);
      autoScrollTimerRef.current = setInterval(() => {
        const next = scrollOffsetRef.current + speed;
        flatListRef.current?.scrollToOffset({ offset: next, animated: false });
        updateSelectionAtPoint(lastPageXRef.current, lastPageYRef.current);
      }, 16);
    }
  }, [stopAutoScroll, updateSelectionAtPoint]);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
      if (!isSelectingRef.current) return false;
      const adx = Math.abs(gestureState.dx);
      const ady = Math.abs(gestureState.dy);
      // 横に動かし始めた → すぐなぞり選択
      const horizontal = adx >= 8 && ady <= adx;
      // 指を少し止めてから動かした → 縦方向でもなぞり選択（素早い縦スワイプはスクロール）
      const heldThenMoved =
        Date.now() - touchDownTimeRef.current >= HOLD_TO_DRAG_MS && (adx >= 4 || ady >= 4);
      if (!horizontal && !heldThenMoved) return false;
      touchStartRef.current = {
        x: evt.nativeEvent.pageX - gestureState.dx,
        y: evt.nativeEvent.pageY - gestureState.dy,
      };
      return true;
    },
    onPanResponderGrant: (evt) => {
      const { pageX, pageY } = evt.nativeEvent;
      const { x: sx, y: sy } = touchStartRef.current;
      const startIdx = getCellIndex(sx, sy);
      const curIdx = getCellIndex(pageX, pageY);
      const si = startIdx !== -1 ? startIdx : curIdx;
      dragStartIdxRef.current = si;
      dragActiveRef.current = true;
      lastPageXRef.current = pageX;
      lastPageYRef.current = pageY;
      if (si !== -1) {
        const photoId = photosRef.current[si]?.id;
        dragModeRef.current = selectedIdsRef.current.has(photoId) ? 'deselect' : 'select';
        initSelectedRef.current = new Set(selectedIdsRef.current);
        const ci = curIdx !== -1 ? curIdx : si;
        lastCellIdxRef.current = ci;
        applyRangeSelection(si, ci);
      }
    },
    onPanResponderMove: (evt) => {
      const { pageX, pageY } = evt.nativeEvent;
      lastPageXRef.current = pageX;
      lastPageYRef.current = pageY;
      updateSelectionAtPoint(pageX, pageY);
      startAutoScrollIfNeeded(pageY);
    },
    onPanResponderRelease: () => {
      stopAutoScroll();
      dragActiveRef.current = false;
      dragStartIdxRef.current = -1;
      lastCellIdxRef.current = -1;
    },
    onPanResponderTerminate: () => {
      stopAutoScroll();
      dragActiveRef.current = false;
    },
  })).current;
  // ──────────────────────────────────────────────────────────────────────────

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
    setRefreshKey(k => k + 1);
  }, [loadData]));

  useLayoutEffect(() => {
    if (isSelecting) {
      navigation.setOptions({
        title: selectedIds.size > 0 ? `${selectedIds.size}件選択` : '選択',
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
        {
          options: ['キャンセル', '写真・動画を追加', 'サブアルバムを作成', '並び順を変更', '写真アプリに書き出し', 'ZIPでエクスポート'],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i === 1) handleImport();
          if (i === 2) handleNewSubAlbum();
          if (i === 3) showSortPicker();
          if (i === 4) promptExportToPhotos({ id: albumId, name: albumName }, setPhotosExportProgress);
          if (i === 5) handleExport();
        }
      );
    } else {
      Alert.alert('', '', [
        { text: '写真・動画を追加', onPress: handleImport },
        { text: 'サブアルバムを作成', onPress: handleNewSubAlbum },
        { text: '並び順を変更', onPress: showSortPicker },
        { text: '写真アプリに書き出し', onPress: () => promptExportToPhotos({ id: albumId, name: albumName }, setPhotosExportProgress) },
        { text: 'ZIPでエクスポート', onPress: handleExport },
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
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      // 元写真を削除しても画質が落ちないよう、元の画質・形式のまま取り込む
      quality: 1,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (result.canceled) return;

    const assets = result.assets;
    // 取り込みに成功した写真の元写真ID（写真アプリ側）
    const importedAssetIds = [];
    let importSucceeded = false;
    setImportProgress({ visible: true, current: 0, total: assets.length });
    try {
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        const isVideo = asset.type === 'video';
        const takenAt = await getCreationTime(asset.assetId);

        let thumbnailUri = null;
        if (isVideo) {
          try {
            const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 0 });
            thumbnailUri = thumb.uri;
          } catch (_) {}
        }

        await db.importMedia(albumId, asset.uri, {
          width: asset.width,
          height: asset.height,
          mediaType: isVideo ? 'video' : 'photo',
          duration: asset.duration ?? null,
          takenAt,
          thumbnailUri,
        });
        if (asset.assetId) importedAssetIds.push(asset.assetId);
        setImportProgress({ visible: true, current: i + 1, total: assets.length });
      }
      importSucceeded = true;
      await loadData();
    } catch (e) {
      Alert.alert('エラー', `インポートに失敗しました。\n${e?.message ?? String(e)}`);
    } finally {
      setImportProgress({ visible: false, current: 0, total: 0 });
    }

    // すべて取り込めたときだけ、元写真の削除を案内する
    if (importSucceeded) askDeleteOriginals(assets.length, importedAssetIds);
  }

  function askDeleteOriginals(importedCount, assetIds) {
    if (assetIds.length === 0) return;
    const notDeletable = importedCount - assetIds.length;
    const note = notDeletable > 0
      ? `\n\n※ ${notDeletable}件は写真アプリ側の元写真を特定できないため削除されません。`
      : '';
    Alert.alert(
      `${importedCount}項目を取り込みました`,
      `写真アプリにある元の写真を削除しますか？\n削除した写真は「最近削除した項目」に30日間残ります。${note}`,
      [
        { text: '残す', style: 'cancel' },
        { text: '削除する', style: 'destructive', onPress: () => deleteOriginals(assetIds) },
      ]
    );
  }

  async function deleteOriginals(assetIds) {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (perm.status !== 'granted' || perm.accessPrivileges !== 'all') {
      Alert.alert(
        'フルアクセスが必要です',
        '元の写真を削除するには、設定アプリでGlimpseの写真へのアクセスを「フルアクセス」にしてください。'
      );
      return;
    }
    try {
      // iOSの確認ダイアログが表示される。キャンセルされた場合は false か例外になる
      const deleted = await MediaLibrary.deleteAssetsAsync(assetIds);
      if (deleted) showToast('元の写真を削除しました');
    } catch (_) {
      // ユーザーがiOSの確認でキャンセルした場合。何もしない
    }
  }

  async function handleExport() {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setExportProgress({ visible: true, current: 0, total: 0 });
    try {
      await albumExport.exportAlbum(
        albumId,
        albumName,
        (current, total) => setExportProgress({ visible: true, current, total }),
        () => setExportProgress({ visible: false, current: 0, total: 0 })
      );
    } catch (e) {
      console.error('[Export] handleExport error:', e);
      Alert.alert('エラー', `エクスポートに失敗しました。\n${e?.message ?? String(e)}`);
    } finally {
      setExportProgress({ visible: false, current: 0, total: 0 });
      isExportingRef.current = false;
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
      { text: '写真アプリに書き出し', onPress: () => promptExportToPhotos(album, setPhotosExportProgress) },
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
          Alert.alert('アルバムを削除', `「${album.name}」とすべての写真・動画を削除しますか？`, [
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
    Alert.alert('削除', `${selectedIds.size}件の写真・動画を削除しますか？`, [
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          const idsToDelete = [...selectedIds];
          const total = idsToDelete.length;
          setDeleteProgress({ visible: true, current: 0, total });
          try {
            for (let i = 0; i < idsToDelete.length; i++) {
              await db.deletePhotos([idsToDelete[i]]);
              setDeleteProgress({ visible: true, current: i + 1, total });
            }
          } catch (e) {
            Alert.alert('エラー', `削除に失敗しました。\n${e?.message ?? String(e)}`);
          } finally {
            setDeleteProgress({ visible: false, current: 0, total: 0 });
          }
          cancelSelect();
          await loadData();
        },
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  }

  async function handlePickerSelect(targetAlbum) {
    setPickerVisible(false);
    try {
      await db.movePhotos([...selectedIds], targetAlbum.id);
      cancelSelect();
      await loadData();
    } catch (e) {
      Alert.alert('エラー', `移動に失敗しました。\n${e?.message ?? String(e)}`);
    }
  }

  function showToast(message) {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

  async function handleSaveToPhotos() {
    if (!hasSelection) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('アクセス許可が必要', '設定アプリでフォトライブラリへの書き込みを許可してください。');
      return;
    }
    try {
      const rows = await Promise.all([...selectedIds].map(id => db.getPhotoById(id)));
      for (const row of rows) {
        if (row?.uri) await MediaLibrary.createAssetAsync(row.uri);
      }
      cancelSelect();
      showToast('カメラロールに保存しました');
    } catch (e) {
      Alert.alert('エラー', `保存に失敗しました。\n${e?.message ?? String(e)}`);
    }
  }

  const hasSelection = selectedIds.size > 0;

  return (
    <View style={styles.container}>
      {/* Segmented sort control */}
      <View style={styles.segContainer}>
        <View style={styles.segControl}>
          {[{ label: '追加日時', value: 'added_at' }, { label: '撮影日時', value: 'taken_at' }, { label: '手動', value: 'manual' }].map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.segBtn, sortMode === opt.value && styles.segBtnActive]}
              onPress={() => setSortMode(opt.value)}
            >
              <Text style={[styles.segBtnText, sortMode === opt.value && styles.segBtnTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View
        ref={containerRef}
        style={{ flex: 1 }}
        onLayout={() => {
          containerRef.current?.measureInWindow((x, y, w, h) => {
            containerLeftRef.current = x;
            containerTopRef.current = y;
            containerHeightRef.current = h;
            containerWidthRef.current = w;
          });
        }}
        onTouchStart={() => { touchDownTimeRef.current = Date.now(); }}
        {...panResponder.panHandlers}
      >
        <FlatList
          ref={flatListRef}
          data={displayData}
          keyExtractor={(item, index) =>
            item.type === 'header' ? `hdr-${item.label}` : `row-${index}`
          }
          numColumns={1}
          contentContainerStyle={styles.photoGrid}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          ListHeaderComponent={subAlbums.length > 0 ? (
            <View
              style={styles.subSection}
              onLayout={(e) => { headerHeightRef.current = e.nativeEvent.layout.height; }}
            >
              <Text style={styles.subSectionTitle}>サブアルバム</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subList}>
                {subAlbums.map(sa => (
                  <SubAlbumCard
                    key={sa.id}
                    album={sa}
                    refreshKey={refreshKey}
                    onPress={() => navigation.push('AlbumDetail', { albumId: sa.id, albumName: sa.name })}
                    onLongPress={() => showSubAlbumMenu(sa)}
                  />
                ))}
              </ScrollView>
              <View style={styles.divider} />
            </View>
          ) : null}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={styles.sectionHeader}>{item.label}</Text>;
            }
            return (
              <View style={[styles.photoRow, { gap: CELL_GAP }]}>
                {item.photos.map(photo => (
                  <MediaCell
                    key={photo.id}
                    photo={photo}
                    cellW={CELL_W}
                    isSelecting={isSelecting}
                    isSelected={selectedIds.has(photo.id)}
                    onPress={() => {
                      if (isSelecting) {
                        toggleSelect(photo.id);
                      } else {
                        const flatIdx = photoFlatIndex.get(photo.id) ?? 0;
                        navigation.navigate('PhotoViewer', { albumId, initialIndex: flatIdx, sortMode });
                      }
                    }}
                    onLongPress={() => {
                      if (!isSelecting) {
                        setIsSelecting(true);
                        setSelectedIds(new Set([photo.id]));
                      }
                    }}
                  />
                ))}
                {Array(NUM_COLS - item.photos.length).fill(null).map((_, i) => (
                  <View key={`gap-${i}`} style={{ width: CELL_W, height: CELL_W, backgroundColor: '#2C2C2E' }} />
                ))}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>写真・動画がありません</Text>
              <Text style={styles.emptyHint}>+ をタップして追加</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: CELL_GAP }} />}
        />
      </View>

      {isSelecting && (
        <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleDeleteSelected} disabled={!hasSelection}>
            <Ionicons name="trash-outline" size={24} color={hasSelection ? '#FF453A' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#FF453A' : '#636366' }]}>削除</Text>
          </TouchableOpacity>
          <View style={styles.actionSep} />
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => { if (hasSelection) { setPickerVisible(true); } }}
            disabled={!hasSelection}
          >
            <Ionicons name="folder-outline" size={24} color={hasSelection ? '#EBEBF5' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#EBEBF5' : '#636366' }]}>移動</Text>
          </TouchableOpacity>
          <View style={styles.actionSep} />
          <TouchableOpacity style={styles.actionBtn} onPress={handleSaveToPhotos} disabled={!hasSelection}>
            <Ionicons name="download-outline" size={24} color={hasSelection ? '#EBEBF5' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#EBEBF5' : '#636366' }]}>写真に保存</Text>
          </TouchableOpacity>
        </View>
      )}

      {toastMessage !== '' && (
        <Animated.View style={[styles.toast, { opacity: toastOpacity, bottom: Math.max(insets.bottom, 16) + 64 }]}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      <ProgressModal
        visible={importProgress.visible}
        title="追加中…"
        current={importProgress.current}
        total={importProgress.total}
      />
      <ProgressModal
        visible={deleteProgress.visible}
        title="削除中…"
        current={deleteProgress.current}
        total={deleteProgress.total}
      />
      <ProgressModal
        visible={exportProgress.visible}
        title="エクスポート中…"
        current={exportProgress.current}
        total={exportProgress.total}
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
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  textBtn: { height: 44, justifyContent: 'center', paddingHorizontal: 4 },
  textBtnLabel: { color: '#EBEBF5', fontSize: 16 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  segContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#1C1C1E',
  },
  segControl: {
    flexDirection: 'row',
    backgroundColor: '#2C2C2E',
    borderRadius: 8,
    padding: 2,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
  },
  segBtnActive: { backgroundColor: '#3A3A3C' },
  segBtnText: { color: '#8E8E93', fontSize: 13, fontWeight: '500' },
  segBtnTextActive: { color: '#EBEBF5' },
  subSection: { paddingTop: 12, paddingBottom: 4 },
  subSectionTitle: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '500',
    paddingHorizontal: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subList: { paddingHorizontal: 12, gap: 10 },
  subCard: { width: 96 },
  subCardName: { color: '#EBEBF5', fontSize: 12, marginTop: 6 },
  subCardCount: { color: '#8E8E93', fontSize: 11, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#3A3A3C', marginTop: 12 },
  sectionHeader: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingTop: 16,
    paddingBottom: 6,
    backgroundColor: '#1C1C1E',
  },
  photoGrid: { paddingBottom: 8 },
  photoRow: { flexDirection: 'row' },
  cellBase: { backgroundColor: '#2C2C2E', overflow: 'hidden' },
  brokenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  brokenText: { color: '#636366', fontSize: 10, fontWeight: '500' },
  videoBadgePlay: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  videoBadgeDuration: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  videoDurationText: { color: '#fff', fontSize: 10, fontWeight: '500' },
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
  actionBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', gap: 4 },
  actionBtnText: { fontSize: 11, fontWeight: '500' },
  actionSep: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: '#3A3A3C' },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(44,44,46,0.95)',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  toastText: { color: '#EBEBF5', fontSize: 14, fontWeight: '500' },
  empty: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: '#8E8E93', fontSize: 17, marginBottom: 8 },
  emptyHint: { color: '#636366', fontSize: 13 },
});
