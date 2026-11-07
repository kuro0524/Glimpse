import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  ScrollView,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as ExpoCrypto from 'expo-crypto';
import CryptoJS from 'crypto-js';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as auth from '../utils/auth';
import * as db from '../utils/db';

const ITERATIONS = 10000;
const BACKUP_VERSION = 1;

function normalizeKey(key) {
  return key.replace(/-/g, '').toUpperCase().trim();
}

// ─── Crypto helpers (expo-crypto for random bytes, crypto-js for PBKDF2 + AES) ─

function uint8ToHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function encryptText(plaintext, password) {
  const saltBytes = await ExpoCrypto.getRandomBytesAsync(16);
  const ivBytes = await ExpoCrypto.getRandomBytesAsync(16);
  const saltHex = uint8ToHex(saltBytes);
  const ivHex = uint8ToHex(ivBytes);

  const encrypted = await new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const key = CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(saltHex), {
          keySize: 8, iterations: ITERATIONS, hasher: CryptoJS.algo.SHA256,
        });
        resolve(CryptoJS.AES.encrypt(plaintext, key, {
          iv: CryptoJS.enc.Hex.parse(ivHex), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
        }));
      } catch (e) { reject(e); }
    }, 0);
  });

  return JSON.stringify({
    version: BACKUP_VERSION,
    salt: saltHex,
    iv: ivHex,
    iterations: ITERATIONS,
    data: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
  });
}

async function decryptText(encryptedJson, password) {
  const { salt, iv, iterations, data } = JSON.parse(encryptedJson);

  const result = await new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const key = CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(salt), {
          keySize: 8, iterations: iterations ?? ITERATIONS, hasher: CryptoJS.algo.SHA256,
        });
        const cipherParams = CryptoJS.lib.CipherParams.create({
          ciphertext: CryptoJS.enc.Base64.parse(data),
        });
        const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
          iv: CryptoJS.enc.Hex.parse(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
        });
        const text = decrypted.toString(CryptoJS.enc.Utf8);
        if (!text) throw new Error('Decryption failed');
        resolve(text);
      } catch (e) { reject(e); }
    }, 0);
  });

  return result;
}

// ─── Backup / Restore logic ──────────────────────────────────────────────────

async function createBackupPayload() {
  const recoveryKey = await auth.getRecoveryKey();
  if (!recoveryKey) throw new Error('RECOVERY_KEY_MISSING');

  const albums = await db.getAllAlbumsRaw();
  const photos = await db.getAllPhotosRaw();
  const photosDir = db.getPhotosDir();

  const files = {};
  for (const photo of photos) {
    for (const field of ['uri', 'thumbnail']) {
      const rawValue = photo[field];
      if (!rawValue) continue;
      const filename = rawValue.split('/').pop();
      if (!filename || files[filename]) continue;
      try {
        const b64 = await FileSystem.readAsStringAsync(`${photosDir}${filename}`, {
          encoding: 'base64',
        });
        files[filename] = b64;
      } catch (_) {}
    }
  }

  return JSON.stringify({
    version: BACKUP_VERSION,
    recoveryKey,
    albums,
    photos: photos.map(p => ({
      id: p.id,
      album_id: p.album_id,
      uri: p.uri.split('/').pop(),
      thumbnail: p.thumbnail ? p.thumbnail.split('/').pop() : null,
      width: p.width,
      height: p.height,
      taken_at: p.taken_at,
      added_at: p.added_at,
      sort_order: p.sort_order,
      is_favorite: p.is_favorite,
      media_type: p.media_type ?? 'photo',
      duration: p.duration ?? null,
      deleted_at: p.deleted_at ?? null,
    })),
    files,
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BackupRestoreView({ navigation, route, mode: modeProp, onRestoreComplete, onGoBack }) {
  const mode = modeProp ?? route?.params?.mode ?? 'both';
  const insets = useSafeAreaInsets();

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFileUri, setRestoreFileUri] = useState(null);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');

  async function handleBackup() {
    const recoveryKey = await auth.getRecoveryKey();
    if (!recoveryKey) {
      Alert.alert(
        'リカバリーキー未設定',
        '設定画面でリカバリーキーを確認してから、バックアップを作成してください。'
      );
      return;
    }

    setIsBackingUp(true);
    try {
      const payload = await createBackupPayload();
      const encrypted = await encryptText(payload, normalizeKey(recoveryKey));
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const backupUri = `${FileSystem.cacheDirectory}glimpse_backup_${ts}.glimpse`;
      await FileSystem.writeAsStringAsync(backupUri, encrypted, {
        encoding: 'utf8',
      });
      await Sharing.shareAsync(backupUri, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'バックアップを保存',
      });
    } catch (e) {
      if (e.message === 'RECOVERY_KEY_MISSING') {
        Alert.alert('エラー', 'リカバリーキーが見つかりません。');
      } else {
        Alert.alert('エラー', `バックアップに失敗しました。\n${e?.message ?? String(e)}`);
      }
    } finally {
      setIsBackingUp(false);
    }
  }

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setRestoreFileUri(asset.uri);
    setRestoreFileName(asset.name ?? 'バックアップファイル');
  }

  async function handleRestore() {
    if (!restoreFileUri) {
      Alert.alert('ファイルを選択してください');
      return;
    }
    if (!recoveryInput.trim()) {
      Alert.alert('リカバリーキーを入力してください');
      return;
    }

    setIsRestoring(true);
    try {
      const raw = await FileSystem.readAsStringAsync(restoreFileUri, {
        encoding: 'utf8',
      });

      let plaintext;
      try {
        plaintext = await decryptText(raw, normalizeKey(recoveryInput.trim()));
      } catch (_) {
        Alert.alert('復号に失敗しました', 'リカバリーキーが正しくありません。再入力してください。');
        return;
      }

      let payload;
      try {
        payload = JSON.parse(plaintext);
      } catch (_) {
        Alert.alert('ファイルが破損しています', '有効なバックアップファイルを選択してください。');
        return;
      }

      await db.restoreFromPayload(payload);
      if (payload.recoveryKey) {
        await auth.setRecoveryKey(payload.recoveryKey);
      }

      if (onRestoreComplete) {
        onRestoreComplete();
      } else {
        Alert.alert('復元完了', 'バックアップから正常に復元されました。', [
          { text: 'OK', onPress: () => navigation?.goBack() },
        ]);
      }
    } catch (e) {
      Alert.alert('エラー', `復元に失敗しました。\n${e?.message ?? String(e)}`);
    } finally {
      setIsRestoring(false);
    }
  }

  const canGoBack = navigation || onGoBack;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {canGoBack && (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (onGoBack) onGoBack();
              else navigation?.goBack();
            }}
          >
            <Ionicons name="chevron-back" size={28} color="#EBEBF5" />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>
          {mode === 'restore' ? 'バックアップから復元' : 'バックアップ / 復元'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Backup section ── */}
        {mode !== 'restore' && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>バックアップを作成</Text>
            <Text style={styles.sectionDesc}>
              全アルバムの写真・動画をリカバリーキーで暗号化して保存します。
              大量の動画がある場合は時間がかかる場合があります。
            </Text>
            <TouchableOpacity
              style={[styles.actionBtn, isBackingUp && styles.actionBtnDisabled]}
              onPress={handleBackup}
              disabled={isBackingUp}
              activeOpacity={0.8}
            >
              {isBackingUp ? (
                <ActivityIndicator color="#EBEBF5" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={20} color="#111111" />
                  <Text style={styles.actionBtnText}>バックアップを作成</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ── Restore section ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>バックアップから復元</Text>
          <Text style={styles.sectionDesc}>
            保存したバックアップファイルを選択し、リカバリーキーを入力して復元します。
            {'\n'}※ 復元時に既存のデータはすべて上書きされます。
          </Text>

          <TouchableOpacity style={styles.filePickerBtn} onPress={handlePickFile} activeOpacity={0.8}>
            <Ionicons name="document-outline" size={20} color="#EBEBF5" />
            <Text style={styles.filePickerText} numberOfLines={1}>
              {restoreFileName || 'ファイルを選択…'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.inputLabel}>リカバリーキー</Text>
          <TextInput
            style={styles.input}
            value={recoveryInput}
            onChangeText={(t) => setRecoveryInput(t.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            placeholderTextColor="#636366"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />

          <TouchableOpacity
            style={[
              styles.actionBtn,
              styles.actionBtnRestore,
              (isRestoring || !restoreFileUri || !recoveryInput.trim()) && styles.actionBtnDisabled,
            ]}
            onPress={handleRestore}
            disabled={isRestoring || !restoreFileUri || !recoveryInput.trim()}
            activeOpacity={0.8}
          >
            {isRestoring ? (
              <ActivityIndicator color="#EBEBF5" />
            ) : (
              <>
                <Ionicons name="cloud-download-outline" size={20} color="#111111" />
                <Text style={styles.actionBtnText}>復元する</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A3A3C',
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#EBEBF5', fontSize: 17, fontWeight: '600' },
  content: { padding: 16, gap: 24 },
  section: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { color: '#EBEBF5', fontSize: 16, fontWeight: '600' },
  sectionDesc: { color: '#8E8E93', fontSize: 13, lineHeight: 18 },
  filePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#3A3A3C',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  filePickerText: { color: '#EBEBF5', fontSize: 14, flex: 1 },
  inputLabel: { color: '#8E8E93', fontSize: 12, fontWeight: '500', marginTop: 4 },
  input: {
    backgroundColor: '#3A3A3C',
    color: '#EBEBF5',
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: 2,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EBEBF5',
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 4,
  },
  actionBtnRestore: { backgroundColor: '#EBEBF5' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { color: '#111111', fontSize: 15, fontWeight: '600' },
});
