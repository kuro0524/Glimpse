import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function SettingsRow({ label, icon, color = '#EBEBF5', onPress, isLast }) {
  return (
    <>
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
        <Ionicons name={icon} size={20} color={color} style={styles.rowIcon} />
        <Text style={[styles.rowText, { color }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={16} color="#636366" />
      </TouchableOpacity>
      {!isLast && <View style={styles.separator} />}
    </>
  );
}

export default function SettingsView({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>セキュリティ</Text>
      <View style={styles.section}>
        <SettingsRow
          label="パスコードを変更"
          icon="keypad-outline"
          onPress={() => navigation.navigate('Lock', { mode: 'changePasscode' })}
        />
        <SettingsRow
          label="リカバリーキーを表示"
          icon="key-outline"
          onPress={() => navigation.navigate('Lock', { mode: 'showRecoveryKey' })}
          isLast
        />
      </View>

      <Text style={styles.sectionHeader}>ライブラリ</Text>
      <View style={styles.section}>
        <SettingsRow
          label="削除済み"
          icon="trash-outline"
          onPress={() => navigation.navigate('Trash')}
          isLast
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    paddingTop: 24,
  },
  sectionHeader: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 6,
    marginTop: 8,
  },
  section: {
    backgroundColor: '#2C2C2E',
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  rowIcon: { width: 22 },
  rowText: {
    flex: 1,
    fontSize: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#3A3A3C',
    marginLeft: 50,
  },
});
