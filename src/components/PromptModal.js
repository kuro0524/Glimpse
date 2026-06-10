import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';

export default function PromptModal({ visible, title, defaultValue = '', onConfirm, onCancel }) {
  const [text, setText] = useState(defaultValue);

  useEffect(() => {
    if (visible) setText(defaultValue);
  }, [visible, defaultValue]);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} />
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btn} onPress={onCancel}>
              <Text style={styles.cancel}>キャンセル</Text>
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.btn} onPress={submit}>
              <Text style={styles.ok}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  box: {
    width: 290,
    backgroundColor: '#2C2C2E',
    borderRadius: 14,
    overflow: 'hidden',
  },
  title: {
    color: '#EBEBF5',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  input: {
    color: '#EBEBF5',
    fontSize: 15,
    backgroundColor: '#1C1C1E',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A3A3C',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#3A3A3C',
  },
  cancel: {
    color: '#EBEBF5',
    fontSize: 16,
  },
  ok: {
    color: '#EBEBF5',
    fontSize: 16,
    fontWeight: '600',
  },
});
