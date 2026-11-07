import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as auth from '../utils/auth';
import * as db from '../utils/db';

const P = {
  LOADING: 'loading',
  WELCOME: 'welcome',
  SETUP: 'setup',
  CONFIRM: 'confirm',
  SHOW_KEY: 'show_key',
  ENTER: 'enter',
  ENTER_RECOVERY: 'enter_recovery',
  VERIFY_CHANGE: 'verify_change',
  CHANGE_NEW: 'change_new',
  CHANGE_CONFIRM: 'change_confirm',
  SHOW_KEY_SETTINGS: 'show_key_settings',
};

const NUMPAD_SUBTITLES = {
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

export default function LockView({ navigation, route, onAuthenticated, onNavigateRestore }) {
  const mode = route?.params?.mode;
  const [phase, setPhase] = useState(P.LOADING);
  const [input, setInput] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [storedKeyDisplay, setStoredKeyDisplay] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [hasRecoveryKey, setHasRecoveryKey] = useState(false);
  const pending = useRef('');
  const fromWelcomeRef = useRef(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      if (mode === 'changePasscode') {
        setPhase(P.VERIFY_CHANGE);
      } else if (mode === 'showRecoveryKey') {
        setPhase(P.VERIFY_CHANGE);
      } else {
        const passcode = await auth.getPasscode();
        if (passcode) {
          setPhase(P.ENTER);
          const key = await auth.getRecoveryKey();
          setHasRecoveryKey(!!key);
        } else {
          const key = await auth.getRecoveryKey();
          // Recovery key exists but no passcode → post-restore setup
          setPhase(key ? P.SETUP : P.WELCOME);
        }
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

  const doWipeAll = useCallback(async () => {
    await auth.wipeAllData();
    await db.wipeAllData();
    setInput('');
    setRecoveryInput('');
    setPhase(P.WELCOME);
  }, []);

  const copyKey = useCallback(async (key) => {
    await Clipboard.setStringAsync(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

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
          const existingKey = await auth.getRecoveryKey();
          // Skip SHOW_KEY only for post-restore (existing key, user did NOT start from Welcome)
          if (existingKey && !fromWelcomeRef.current) {
            if (onAuthenticated) onAuthenticated();
            else navigation?.replace('AlbumList');
          } else {
            fromWelcomeRef.current = false;
            const newKey = await auth.generateRecoveryKey();
            setGeneratedKey(newKey);
            setKeySaved(false);
            setPhase(P.SHOW_KEY);
          }
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
          if (onAuthenticated) onAuthenticated();
          else navigation?.replace('AlbumList');
        } else {
          const count = await auth.incrementFailCount();
          if (count >= 10) {
            await doWipeAll();
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
          if (mode === 'showRecoveryKey') {
            let key = await auth.getRecoveryKey();
            if (!key) key = await auth.generateRecoveryKey();
            setStoredKeyDisplay(key);
            setPhase(P.SHOW_KEY_SETTINGS);
          } else {
            setPhase(P.CHANGE_NEW);
          }
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
          if (mode === 'changePasscode') {
            // Called from Settings — just go back, user is already authenticated.
            navigation?.goBack();
          } else {
            // Called after recovery key reset — need to authenticate into the app.
            if (onAuthenticated) onAuthenticated();
            else navigation?.replace('AlbumList');
          }
        } else {
          triggerShake();
          setPhase(P.CHANGE_NEW);
        }
        break;
      }
    }
  }, [phase, mode, navigation, triggerShake, onAuthenticated, doWipeAll]);

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

  async function handleRecoverySubmit() {
    const storedKey = await auth.getRecoveryKey();
    if (!storedKey) {
      Alert.alert(
        'リカバリーキーが見つかりません',
        '設定画面からリカバリーキーを確認してください。パスコードを覚えている場合はパスコード入力に戻ってください。'
      );
      return;
    }
    const isValid = await auth.verifyRecoveryKey(recoveryInput);
    if (isValid) {
      await auth.resetFailCount();
      setRecoveryInput('');
      pending.current = '';
      setPhase(P.CHANGE_NEW);
      return;
    }
    const count = await auth.incrementFailCount();
    if (count >= 10) {
      await doWipeAll();
      return;
    }
    setRecoveryInput('');
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }

  if (phase === P.LOADING) return null;

  // ─── WELCOME ───────────────────────────────────────────────────────────────
  if (phase === P.WELCOME) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Glimpse</Text>
        <Text style={styles.welcomeSubtitle}>ようこそ</Text>
        <View style={styles.welcomeBtns}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { fromWelcomeRef.current = true; setPhase(P.SETUP); }}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>新しく始める</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => {
              if (onNavigateRestore) {
                onNavigateRestore();
              } else {
                navigation?.navigate('BackupRestore', { mode: 'restore' });
              }
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryBtnText}>バックアップから復元する</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── SHOW_KEY (initial recovery key display) ────────────────────────────────
  if (phase === P.SHOW_KEY) {
    return (
      <ScrollView contentContainerStyle={styles.keyContainer}>
        <Text style={styles.title}>Glimpse</Text>
        <Text style={styles.keyTitle}>リカバリーキー</Text>
        <View style={styles.keyBox}>
          <Text style={styles.keyDisplayText} selectable>{generatedKey}</Text>
        </View>
        <TouchableOpacity style={styles.copyBtn} onPress={() => copyKey(generatedKey)} activeOpacity={0.7}>
          <Ionicons name="copy-outline" size={16} color="#EBEBF5" />
          <Text style={styles.copyBtnText}>{copied ? 'コピーしました' : 'コピー'}</Text>
        </TouchableOpacity>
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            このキーは設定画面で現在のパスコードを入力すれば再確認できます。{'\n\n'}
            安全な場所に保管してください。{'\n\n'}
            紛失した場合、開発者側も復旧に対応できません。
          </Text>
        </View>
        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setKeySaved(v => !v)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={keySaved ? 'checkbox' : 'square-outline'}
            size={24}
            color={keySaved ? '#EBEBF5' : '#636366'}
          />
          <Text style={styles.checkLabel}>保存しました</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryBtn, !keySaved && styles.primaryBtnDisabled]}
          disabled={!keySaved}
          onPress={() => {
            if (onAuthenticated) onAuthenticated();
            else navigation?.replace('AlbumList');
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>次へ</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ─── SHOW_KEY_SETTINGS (view key from settings) ─────────────────────────────
  if (phase === P.SHOW_KEY_SETTINGS) {
    return (
      <ScrollView contentContainerStyle={styles.keyContainer}>
        <Text style={styles.title}>Glimpse</Text>
        <Text style={styles.keyTitle}>リカバリーキー</Text>
        <View style={styles.keyBox}>
          <Text style={styles.keyDisplayText} selectable>{storedKeyDisplay}</Text>
        </View>
        <TouchableOpacity style={styles.copyBtn} onPress={() => copyKey(storedKeyDisplay)} activeOpacity={0.7}>
          <Ionicons name="copy-outline" size={16} color="#EBEBF5" />
          <Text style={styles.copyBtnText}>{copied ? 'コピーしました' : 'コピー'}</Text>
        </TouchableOpacity>
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            このキーを安全な場所に保管してください。{'\n\n'}
            紛失した場合、開発者側も復旧に対応できません。
          </Text>
        </View>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation?.goBack()}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>完了</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ─── ENTER_RECOVERY ─────────────────────────────────────────────────────────
  if (phase === P.ENTER_RECOVERY) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Glimpse</Text>
        <Text style={styles.subtitle}>リカバリーキーを入力</Text>
        <Animated.View style={{ transform: [{ translateX: shakeAnim }], width: '100%', alignItems: 'center' }}>
          <TextInput
            style={styles.recoveryInput}
            value={recoveryInput}
            onChangeText={(t) => setRecoveryInput(t.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            placeholderTextColor="#636366"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoFocus
          />
        </Animated.View>
        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }]}
          onPress={handleRecoverySubmit}
          disabled={recoveryInput.trim().length < 3}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>確認</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => { setPhase(P.ENTER); setRecoveryInput(''); }}
        >
          <Text style={styles.linkBtnText}>パスコード入力に戻る</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ─── Numpad phases ─────────────────────────────────────────────────────────
  const subtitle = NUMPAD_SUBTITLES[phase] ?? '';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Glimpse</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <Animated.View
        style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}
      >
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[styles.dot, i < input.length && styles.dotFilled]} />
        ))}
      </Animated.View>

      <View style={styles.numpad}>
        {NUMPAD.map((row, ri) => (
          <View key={ri} style={styles.numRow}>
            {row.map((key, ki) => {
              if (key === '') return <View key={ki} style={styles.keyPlaceholder} />;
              return (
                <TouchableOpacity
                  key={ki}
                  style={styles.key}
                  onPress={key === '⌫' ? handleBackspace : () => handlePress(key)}
                  activeOpacity={0.5}
                >
                  <Text style={[styles.keyText, key === '⌫' && styles.backspaceText]}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {phase === P.ENTER && hasRecoveryKey && (
        <TouchableOpacity
          style={styles.linkBtn}
          onPress={() => { setInput(''); setPhase(P.ENTER_RECOVERY); }}
        >
          <Text style={styles.linkBtnText}>パスコードを忘れた場合</Text>
        </TouchableOpacity>
      )}
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
    paddingHorizontal: 24,
  },
  keyContainer: {
    flexGrow: 1,
    backgroundColor: '#1C1C1E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  title: {
    color: '#EBEBF5',
    fontSize: 28,
    fontWeight: '300',
    letterSpacing: 4,
    marginBottom: 8,
  },
  welcomeSubtitle: {
    color: '#8E8E93',
    fontSize: 16,
    marginBottom: 60,
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 14,
    marginBottom: 44,
  },
  keyTitle: {
    color: '#EBEBF5',
    fontSize: 20,
    fontWeight: '500',
    marginBottom: 24,
    marginTop: 8,
  },
  keyBox: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 28,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center',
  },
  keyDisplayText: {
    color: '#EBEBF5',
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: 4,
  },
  warningBox: {
    backgroundColor: '#2C2C2E',
    borderRadius: 10,
    padding: 16,
    marginBottom: 24,
    width: '100%',
  },
  warningText: {
    color: '#8E8E93',
    fontSize: 13,
    lineHeight: 19,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  copyBtnText: {
    color: '#EBEBF5',
    fontSize: 15,
    fontWeight: '500',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    marginBottom: 28,
    alignSelf: 'flex-start',
  },
  checkLabel: {
    color: '#EBEBF5',
    fontSize: 15,
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
  numpad: { gap: 14 },
  numRow: { flexDirection: 'row', gap: 20 },
  key: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPlaceholder: { width: 78, height: 78 },
  keyText: {
    color: '#EBEBF5',
    fontSize: 28,
    fontWeight: '300',
  },
  backspaceText: { fontSize: 22 },
  welcomeBtns: {
    width: '100%',
    gap: 16,
    alignItems: 'center',
  },
  primaryBtn: {
    backgroundColor: '#EBEBF5',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.35,
  },
  primaryBtnText: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '600',
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#EBEBF5',
    fontSize: 16,
  },
  recoveryInput: {
    backgroundColor: '#2C2C2E',
    color: '#EBEBF5',
    fontSize: 22,
    fontWeight: '500',
    letterSpacing: 3,
    textAlign: 'center',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
  },
  linkBtn: {
    marginTop: 28,
    paddingVertical: 12,
  },
  linkBtnText: {
    color: '#EBEBF5',
    fontSize: 14,
  },
});
