import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  StatusBar,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import * as db from '../utils/db';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

function PhotoPage({ photo, onTap }) {
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
      <Animated.View style={[styles.page, animStyle]}>
        <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="contain" />
      </Animated.View>
    </GestureDetector>
  );
}

export default function PhotoViewerView({ navigation, route }) {
  const { albumId, initialIndex = 0, sortMode = 'added_at' } = route.params;
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showUI, setShowUI] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
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
    Alert.alert('写真を削除', 'この写真は完全に削除されます。', [
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

  return (
    <View style={styles.container}>
      <StatusBar hidden={!showUI} animated />

      <FlatList
        ref={flatListRef}
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={p => p.id}
        renderItem={({ item }) => <PhotoPage photo={item} onTap={toggleUI} />}
        getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
        initialScrollIndex={initialIndex}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        decelerationRate="fast"
      />

      {showUI && (
        <>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
              <Ionicons name="chevron-back" size={28} color="#EBEBF5" />
            </TouchableOpacity>
            <Text style={styles.counter}>{currentIndex + 1} / {photos.length}</Text>
            <TouchableOpacity onPress={handleShare} style={styles.headerBtn} activeOpacity={0.6}>
              <Ionicons name="share-outline" size={26} color="#EBEBF5" />
            </TouchableOpacity>
          </View>

          {/* Footer */}
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
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  page: {
    width: SCREEN_W,
    height: SCREEN_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photo: {
    width: SCREEN_W,
    height: SCREEN_H,
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
  counter: {
    color: '#EBEBF5',
    fontSize: 15,
    fontWeight: '500',
  },
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
});
