import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function SettingsView({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('Lock', { mode: 'changePasscode' })}
        >
          <Text style={styles.rowText}>パスコードを変更</Text>
        </TouchableOpacity>
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
  section: {
    backgroundColor: '#2C2C2E',
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
  },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: {
    color: '#EBEBF5',
    fontSize: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#3A3A3C',
    marginLeft: 16,
  },
});
