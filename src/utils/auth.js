import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const K = {
  PASSCODE: 'glimpse_passcode',
  FAIL_COUNT: 'glimpse_fail_count',
  RECOVERY_KEY: 'glimpse_recovery_key',
};

// Visually unambiguous chars (no 0/O, 1/I/L)
const RECOVERY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const getPasscode = () => SecureStore.getItemAsync(K.PASSCODE);
export const setPasscode = (code) => SecureStore.setItemAsync(K.PASSCODE, code);

export const getRecoveryKey = () => SecureStore.getItemAsync(K.RECOVERY_KEY);
export const setRecoveryKey = (key) => SecureStore.setItemAsync(K.RECOVERY_KEY, key);

export async function generateRecoveryKey() {
  const bytes = await Crypto.getRandomBytesAsync(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += RECOVERY_CHARS[bytes[i] % RECOVERY_CHARS.length];
  }
  const key = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  await setRecoveryKey(key);
  return key;
}

export async function verifyRecoveryKey(input) {
  const stored = await getRecoveryKey();
  if (!stored) return false;
  const norm = (s) => s.replace(/-/g, '').toUpperCase().trim();
  return norm(input) === norm(stored);
}

export async function getFailCount() {
  const v = await SecureStore.getItemAsync(K.FAIL_COUNT);
  return v ? parseInt(v, 10) : 0;
}

export async function incrementFailCount() {
  const count = await getFailCount();
  const next = count + 1;
  await SecureStore.setItemAsync(K.FAIL_COUNT, String(next));
  return next;
}

export const resetFailCount = () => SecureStore.setItemAsync(K.FAIL_COUNT, '0');

export async function wipeAllData() {
  await Promise.all([
    SecureStore.deleteItemAsync(K.PASSCODE),
    SecureStore.deleteItemAsync(K.FAIL_COUNT),
    SecureStore.deleteItemAsync(K.RECOVERY_KEY),
    SecureStore.deleteItemAsync('glimpse_fake_passcode'),
  ]);
}
