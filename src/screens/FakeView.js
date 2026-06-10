import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function FakeView() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>(no date)</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#3A3A3C',
    fontSize: 14,
  },
});
