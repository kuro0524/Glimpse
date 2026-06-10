import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { getAllAlbums } from '../utils/db';

export default function AlbumPickerModal({ visible, excludeId, onPick, onCancel }) {
  const [albums, setAlbums] = useState([]);

  useEffect(() => {
    if (visible) {
      getAllAlbums().then(all => setAlbums(all.filter(a => a.id !== excludeId)));
    }
  }, [visible, excludeId]);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>アルバムを選択</Text>
            <TouchableOpacity onPress={onCancel}>
              <Text style={styles.cancel}>キャンセル</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={albums}
            keyExtractor={a => a.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onPick(item)}>
                <Text style={styles.rowText}>{item.name}</Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={<Text style={styles.empty}>アルバムがありません</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#2C2C2E',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: '60%',
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A3A3C',
  },
  title: {
    color: '#EBEBF5',
    fontSize: 16,
    fontWeight: '600',
  },
  cancel: {
    color: '#EBEBF5',
    fontSize: 15,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: {
    color: '#EBEBF5',
    fontSize: 16,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#3A3A3C',
    marginLeft: 16,
  },
  empty: {
    color: '#8E8E93',
    fontSize: 14,
    textAlign: 'center',
    padding: 32,
  },
});
