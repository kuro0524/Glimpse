import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  Alert,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as Sharing from 'expo-sharing';
import * as db from '../utils/db';

function PhotoPage({ photo, onTap, pageW, pageH }) {
  const [broken, setBroken] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pinch = Gesture.Pinch()
    .onBegin(() => { savedScale.value = scale.value; })
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value < 1.08) {
        scale.value = withSpring(1, { damping: 15 });
        savedScale.value = 1;
      }
    });

  const tap = Gesture.Tap()
    .maxDuration(200)
    .runOnJS(true)
    .onEnd(() => onTap());

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, tap)}>
      <Animated.View style={[styles.page, { width: pageW, height: pageH }, animStyle]}>
        {broken ? (
          <View style={styles.brokenPage}>
            <Ionicons name="image-outline" size={48} color="#636366" />
            <Text style={styles.brokenText}>この写真は読み込めません</Text>
            <Text style={styles.brokenHint}>ファイルが見つかりません。削除してください。</Text>
          </View>
        ) : (
          <Image
            source={{ uri: photo.uri }}
            style={{ width: pageW, height: pageH }}
            resizeMode="contain"
            onError={() => setBroken(true)}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function VideoPage({ photo, isActive, isMuted, onTap, pageW, pageH }) {
  const player = useVideoPlayer(photo.uri, p => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, player]);

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  return (
    <TouchableOpacity
      style={[styles.page, { width: pageW, height: pageH }]}
      activeOpacity={1}
      onPress={onTap}
    >
      <VideoView
        player={player}
        style={{ width: pageW, height: pageH }}
        nativeControls={true}
        contentFit="contain"
      />
    </TouchableOpacity>
  );
}

export default function PhotoViewerView({ navigation, route }) {
  const { albumId, initialIndex = 0, sortMode = 'added_at' } = route.params;
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showUI, setShowUI] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const flatListRef = useRef(null);

  useEffect(() => {
    db.getPhotos(albumId, sortMode).then(data => {
      setPhotos(data);
      if (data[initialIndex]) {
        setIsFavorite(data[initialIndex].is_favorite === 1);
      }
    });
  }, [albumId, sortMode, initialIndex]);

  useEffect(() => {
    if (photos[currentIndex]) {
      setIsFavorite(photos[currentIndex].is_favorite === 1);
    }
    // Reset mute when navigating to any item
    setIsMuted(true);
  }, [currentIndex, photos]);

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    if (viewableItems[0] != null) {
      setCurrentIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const toggleUI = useCallback(() => setShowUI(v => !v), []);

  async function handleFavorite() {
    const photo = photos[currentIndex];
    if (!photo) return;
    const newVal = await db.toggleFavorite(photo.id);
    setIsFavorite(newVal);
    setPhotos(prev =>
      prev.map((p, i) => i === currentIndex ? { ...p, is_favorite: newVal ? 1 : 0 } : p)
    );
  }

  async function handleDelete() {
    const photo = photos[currentIndex];
    if (!photo) return;
    Alert.alert('削除', 'この写真・動画を削除しますか？', [
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          await db.deletePhotos([photo.id]);
          const newPhotos = photos.filter((_, i) => i !== currentIndex);
          if (newPhotos.length === 0) {
            navigation.goBack();
            return;
          }
          const newIndex = Math.min(currentIndex, newPhotos.length - 1);
          setPhotos(newPhotos);
          setCurrentIndex(newIndex);
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: newIndex, animated: false });
          }, 0);
        },
      },
      { text: 'キャンセル', style: 'cancel' },
    ]);
  }

  async function handleShare() {
    const photo = photos[currentIndex];
    if (!photo) return;
    const available = await Sharing.isAvailableAsync();
    if (!available) {
      Alert.alert('このデバイスでは共有できません。');
      return;
    }
    await Sharing.shareAsync(photo.uri);
  }

  if (photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];
  const isCurrentVideo = currentPhoto?.media_type === 'video';

  return (
    <View style={styles.container}>
      <StatusBar hidden={!showUI} animated />

      <FlatList
        key={SCREEN_W}
        ref={flatListRef}
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={p => p.id}
        renderItem={({ item, index }) => {
          if (item.media_type === 'video') {
            return (
              <VideoPage
                photo={item}
                isActive={index === currentIndex}
                isMuted={isMuted}
                onTap={toggleUI}
                pageW={SCREEN_W}
                pageH={SCREEN_H}
              />
            );
          }
          return <PhotoPage photo={item} onTap={toggleUI} pageW={SCREEN_W} pageH={SCREEN_H} />;
        }}
        getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
        initialScrollIndex={currentIndex}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        decelerationRate="fast"
      />

      {showUI && (
        <>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
              <Ionicons name="chevron-back" size={28} color="#EBEBF5" />
            </TouchableOpacity>
            <Text style={styles.counter}>{currentIndex + 1} / {photos.length}</Text>
            <View style={styles.headerRight}>
              {isCurrentVideo && (
                <TouchableOpacity
                  style={styles.headerBtn}
                  onPress={() => setIsMuted(v => !v)}
                  activeOpacity={0.6}
                >
                  <Ionicons
                    name={isMuted ? 'volume-mute' : 'volume-high'}
                    size={24}
                    color="#EBEBF5"
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleShare} style={styles.headerBtn} activeOpacity={0.6}>
                <Ionicons name="share-outline" size={26} color="#EBEBF5" />
              </TouchableOpacity>
            </View>
          </View>

          {!isCurrentVideo && (
            <View style={styles.footer}>
              <TouchableOpacity style={styles.footerBtn} onPress={handleFavorite} activeOpacity={0.6}>
                <Ionicons
                  name={isFavorite ? 'heart' : 'heart-outline'}
                  size={28}
                  color={isFavorite ? '#FF453A' : '#EBEBF5'}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.footerBtn} onPress={handleDelete} activeOpacity={0.6}>
                <Ionicons name="trash-outline" size={26} color="#FF453A" />
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  page: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  counter: { color: '#EBEBF5', fontSize: 15, fontWeight: '500' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 20,
    paddingBottom: 44,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  footerBtn: {
    width: 64,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brokenPage: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 32,
  },
  brokenText: { color: '#8E8E93', fontSize: 16, fontWeight: '500' },
  brokenHint: { color: '#636366', fontSize: 13, textAlign: 'center' },
});
