import React, { useState, useCallback, useLayoutEffect, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  useWindowDimensions,
  StyleSheet,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as db from '../utils/db';
import ProgressModal from '../components/ProgressModal';

const CELL_GAP = 2;

function daysRemaining(deletedAt) {
  const purgeAt = deletedAt + db.TRASH_RETENTION_DAYS * 86400;
  const secondsLeft = purgeAt - Math.floor(Date.now() / 1000);
  return Math.max(0, Math.ceil(secondsLeft / 86400));
}

function TrashCell({ photo, isSelecting, isSelected, onPress, onLongPress, cellW }) {
  const [broken, setBroken] = useState(false);
  const isVideo = photo.media_type === 'video';
  const displayUri = photo.thumbnailUri ?? photo.uri;
  const daysLeft = daysRemaining(photo.deleted_at);

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
        <View style={styles.videoBadgePlay}>
          <Ionicons name="play" size={10} color="#fff" />
        </View>
      )}
      <View style={styles.daysBadge}>
        <Text style={styles.daysBadgeText}>
          {daysLeft > 0 ? `あと${daysLeft}日` : 'まもなく削除'}
        </Text>
      </View>
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

export default function TrashView({ navigation }) {
  const { width: windowWidth } = useWindowDimensions();
  const NUM_COLS = windowWidth > 600 ? 5 : 3;
  const CELL_W = (windowWidth - CELL_GAP * (NUM_COLS - 1)) / NUM_COLS;

  const [items, setItems] = useState([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [restoreProgress, setRestoreProgress] = useState({ visible: false, current: 0, total: 0 });
  const [deleteProgress, setDeleteProgress] = useState({ visible: false, current: 0, total: 0 });
  const insets = useSafeAreaInsets();

  // ── drag-to-select ────────────────────────────────────────────────────────
  const containerRef = useRef(null);
  const flatListRef = useRef(null);
  const scrollOffsetRef = useRef(0);
  const containerTopRef = useRef(0);
  const containerLeftRef = useRef(0);
  const containerHeightRef = useRef(0);
  const containerWidthRef = useRef(0);
  const numColsRef = useRef(NUM_COLS);
  const cellWRef = useRef(CELL_W);

  const isSelectingRef = useRef(false);
  const selectedIdsRef = useRef(new Set());
  const itemsRef = useRef([]);

  const dragActiveRef = useRef(false);
  const dragModeRef = useRef('select');
  const dragStartIdxRef = useRef(-1);
  const lastCellIdxRef = useRef(-1);
  const initSelectedRef = useRef(new Set());
  const lastPageXRef = useRef(0);
  const lastPageYRef = useRef(0);
  const autoScrollTimerRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0 });
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => { isSelectingRef.current = isSelecting; }, [isSelecting]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => {
    numColsRef.current = NUM_COLS;
    cellWRef.current = CELL_W;
  }, [NUM_COLS, CELL_W]);

  const loadData = useCallback(async () => {
    const data = await db.getDeletedPhotos();
    setItems(data);
    setSelectedIds(prev => {
      if (prev.size === 0) return prev;
      const validIds = new Set(data.map(p => p.id));
      const next = new Set([...prev].filter(id => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  useFocusEffect(useCallback(() => {
    loadData();
  }, [loadData]));

  // The retention-based auto-purge can run in the background (app launch /
  // foreground resume) while this screen is already mounted and focused, in
  // which case useFocusEffect above won't re-fire. Stay in sync via this event.
  useEffect(() => {
    return db.onTrashChanged(loadData);
  }, [loadData]);

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
        title: '削除済み',
        headerLeft: undefined,
        headerRight: () => (
          items.length > 0 ? (
            <TouchableOpacity onPress={() => setIsSelecting(true)} style={styles.textBtn}>
              <Text style={styles.textBtnLabel}>選択</Text>
            </TouchableOpacity>
          ) : null
        ),
      });
    }
  }, [navigation, isSelecting, selectedIds.size, items.length]);

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

  // ── drag-to-select helpers ────────────────────────────────────────────────
  const getCellIndex = useCallback((pageX, pageY) => {
    const nc = numColsRef.current;
    const cw = cellWRef.current;
    const containerLeft = containerLeftRef.current;
    const containerWidth = containerWidthRef.current || (cw * nc + CELL_GAP * (nc - 1));

    const localX = pageX - containerLeft;
    const localY = pageY - containerTopRef.current + scrollOffsetRef.current;

    if (localX < 0 || localX >= containerWidth || localY < 0) return -1;

    const col = Math.min(Math.floor(localX * nc / containerWidth), nc - 1);
    const row = Math.floor(localY / (cw + CELL_GAP));
    const idx = row * nc + col;
    return idx < itemsRef.current.length ? idx : -1;
  }, []);

  const applyRangeSelection = useCallback((startIdx, endIdx) => {
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const list = itemsRef.current;
    const next = new Set(initSelectedRef.current);
    for (let i = lo; i <= hi; i++) {
      if (i < list.length) {
        const id = list[i].id;
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
      if (adx < 8) return false;
      if (ady > adx) return false;
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
        const itemId = itemsRef.current[si]?.id;
        dragModeRef.current = selectedIdsRef.current.has(itemId) ? 'deselect' : 'select';
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

  const hasSelection = selectedIds.size > 0;

  async function handleRestoreSelected() {
    if (!hasSelection) return;
    const idsToRestore = [...selectedIds];
    const total = idsToRestore.length;
    setRestoreProgress({ visible: true, current: 0, total });
    try {
      for (let i = 0; i < idsToRestore.length; i++) {
        await db.restorePhotos([idsToRestore[i]]);
        setRestoreProgress({ visible: true, current: i + 1, total });
      }
    } catch (e) {
      Alert.alert('エラー', `復元に失敗しました。\n${e?.message ?? String(e)}`);
    } finally {
      setRestoreProgress({ visible: false, current: 0, total: 0 });
    }
    cancelSelect();
    await loadData();
  }

  function handleDeleteSelected() {
    if (!hasSelection) return;
    Alert.alert(
      '完全に削除',
      `${selectedIds.size}件の写真・動画を完全に削除しますか？この操作は取り消せません。`,
      [
        {
          text: '完全に削除',
          style: 'destructive',
          onPress: async () => {
            const idsToDelete = [...selectedIds];
            const total = idsToDelete.length;
            setDeleteProgress({ visible: true, current: 0, total });
            try {
              for (let i = 0; i < idsToDelete.length; i++) {
                await db.permanentlyDeletePhotos([idsToDelete[i]]);
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
      ]
    );
  }

  return (
    <View style={styles.container}>
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
        {...panResponder.panHandlers}
      >
        <FlatList
          ref={flatListRef}
          data={items}
          keyExtractor={p => p.id}
          numColumns={NUM_COLS}
          key={NUM_COLS}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={NUM_COLS > 1 ? { gap: CELL_GAP } : undefined}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          renderItem={({ item }) => (
            <TrashCell
              photo={item}
              cellW={CELL_W}
              isSelecting={isSelecting}
              isSelected={selectedIds.has(item.id)}
              onPress={() => { if (isSelecting) toggleSelect(item.id); }}
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
              <Ionicons name="trash-outline" size={40} color="#636366" />
              <Text style={styles.emptyText}>ゴミ箱は空です</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: CELL_GAP }} />}
        />
      </View>

      {isSelecting && (
        <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.actionBtn} onPress={handleRestoreSelected} disabled={!hasSelection}>
            <Ionicons name="refresh-outline" size={24} color={hasSelection ? '#EBEBF5' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#EBEBF5' : '#636366' }]}>復元</Text>
          </TouchableOpacity>
          <View style={styles.actionSep} />
          <TouchableOpacity style={styles.actionBtn} onPress={handleDeleteSelected} disabled={!hasSelection}>
            <Ionicons name="trash-outline" size={24} color={hasSelection ? '#FF453A' : '#636366'} />
            <Text style={[styles.actionBtnText, { color: hasSelection ? '#FF453A' : '#636366' }]}>完全に削除</Text>
          </TouchableOpacity>
        </View>
      )}

      <ProgressModal
        visible={restoreProgress.visible}
        title="復元中…"
        current={restoreProgress.current}
        total={restoreProgress.total}
      />
      <ProgressModal
        visible={deleteProgress.visible}
        title="削除中…"
        current={deleteProgress.current}
        total={deleteProgress.total}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  textBtn: { height: 44, justifyContent: 'center', paddingHorizontal: 4 },
  textBtnLabel: { color: '#EBEBF5', fontSize: 16 },
  grid: { flexGrow: 1, padding: 0 },
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
  daysBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  daysBadgeText: { color: '#fff', fontSize: 10, fontWeight: '500' },
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
  empty: { alignItems: 'center', marginTop: 100, gap: 10 },
  emptyText: { color: '#8E8E93', fontSize: 15 },
});
