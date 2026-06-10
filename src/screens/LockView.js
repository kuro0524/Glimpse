import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import * as auth from '../utils/auth';

const P = {
  LOADING: 'loading',
  SETUP: 'setup',
  CONFIRM: 'confirm',
  ENTER: 'enter',
  VERIFY_CHANGE: 'verify_change',
  CHANGE_NEW: 'change_new',
  CHANGE_CONFIRM: 'change_confirm',
};

const SUBTITLES = {
  [P.SETUP]: 'パスコードを設定',
  [P.CONFIRM]: 'パスコードを確認',
  [P.ENTER]: 'パスコードを入力',
  [P.VERIFY_CHANGE]: '現在のパスコードを入力',
  [P.CHANGE_NEW]: '新しいパスコードを入力',
  [P.CHANGE_CONFIRM]: '新しいパスコードを確認',
};

const NUMPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

export default function LockView({ navigation, route }) {
  const mode = route?.params?.mode;
  const [phase, setPhase] = useState(P.LOADING);
  const [input, setInput] = useState('');
  const pending = useRef('');
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      if (mode === 'changePasscode') {
        setPhase(P.VERIFY_CHANGE);
      } else {
        const passcode = await auth.getPasscode();
        setPhase(passcode ? P.ENTER : P.SETUP);
      }
    })();
  }, [mode]);

  const triggerShake = useCallback(() => {
    setInput('');
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handleComplete = useCallback(async (code) => {
    switch (phase) {
      case P.SETUP: {
        pending.current = code;
        setInput('');
        setPhase(P.CONFIRM);
        break;
      }
      case P.CONFIRM: {
        if (code === pending.current) {
          await auth.setPasscode(code);
          navigation.replace('AlbumList');
        } else {
          triggerShake();
          setPhase(P.SETUP);
        }
        break;
      }
      case P.ENTER: {
        const passcode = await auth.getPasscode();
        if (code === passcode) {
          await auth.resetFailCount();
          navigation.replace('AlbumList');
        } else {
          const count = await auth.incrementFailCount();
          if (count >= 10) {
            await auth.wipeAllData();
            setInput('');
            setPhase(P.SETUP);
          } else {
            triggerShake();
          }
        }
        break;
      }
      case P.VERIFY_CHANGE: {
        const passcode = await auth.getPasscode();
        if (code === passcode) {
          setInput('');
          setPhase(P.CHANGE_NEW);
        } else {
          triggerShake();
        }
        break;
      }
      case P.CHANGE_NEW: {
        pending.current = code;
        setInput('');
        setPhase(P.CHANGE_CONFIRM);
        break;
      }
      case P.CHANGE_CONFIRM: {
        if (code === pending.current) {
          await auth.setPasscode(code);
          navigation.goBack();
        } else {
          triggerShake();
          setPhase(P.CHANGE_NEW);
        }
        break;
      }
    }
  }, [phase, navigation, triggerShake]);

  const handlePress = useCallback((digit) => {
    if (input.length >= 4) return;
    const next = input + digit;
    setInput(next);
    if (next.length === 4) {
      setTimeout(() => handleComplete(next), 80);
    }
  }, [input, handleComplete]);

  const handleBackspace = useCallback(() => {
    setInput(prev => prev.slice(0, -1));
  }, []);

  if (phase === P.LOADING) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Glimpse</Text>
      <Text style={styles.subtitle}>{SUBTITLES[phase]}</Text>

      <Animated.View
        style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}
      >
        {[0, 1, 2, 3].map(i => (
          <View
            key={i}
            style={[styles.dot, i < input.length && styles.dotFilled]}
          />
        ))}
      </Animated.View>

      <View style={styles.numpad}>
        {NUMPAD.map((row, ri) => (
          <View key={ri} style={styles.numRow}>
            {row.map((key, ki) => {
              if (key === '') {
                return <View key={ki} style={styles.keyPlaceholder} />;
              }
              return (
                <TouchableOpacity
                  key={ki}
                  style={styles.key}
                  onPress={key === '⌫' ? handleBackspace : () => handlePress(key)}
                  activeOpacity={0.5}
                >
                  <Text style={[styles.keyText, key === '⌫' && styles.backspaceText]}>
                    {key}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 32,
  },
  title: {
    color: '#EBEBF5',
    fontSize: 28,
    fontWeight: '300',
    letterSpacing: 4,
    marginBottom: 8,
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 14,
    marginBottom: 44,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 60,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#8E8E93',
  },
  dotFilled: {
    backgroundColor: '#EBEBF5',
    borderColor: '#EBEBF5',
  },
  numpad: {
    gap: 14,
  },
  numRow: {
    flexDirection: 'row',
    gap: 20,
  },
  key: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPlaceholder: {
    width: 78,
    height: 78,
  },
  keyText: {
    color: '#EBEBF5',
    fontSize: 28,
    fontWeight: '300',
  },
  backspaceText: {
    fontSize: 22,
  },
});
