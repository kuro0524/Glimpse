import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';

export default function ProgressModal({ visible, title, current, total }) {
  const progress = total > 0 ? Math.min(current / total, 1) : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.counter}>{current} / {total}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    backgroundColor: '#2C2C2E',
    borderRadius: 16,
    padding: 28,
    width: 320,
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: '#EBEBF5',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  counter: {
    color: '#8E8E93',
    fontSize: 14,
  },
  track: {
    width: '100%',
    height: 4,
    backgroundColor: '#3A3A3C',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4,
  },
  fill: {
    height: '100%',
    backgroundColor: '#0A84FF',
    borderRadius: 2,
  },
});
