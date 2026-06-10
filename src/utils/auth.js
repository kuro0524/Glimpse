import * as SecureStore from 'expo-secure-store';

const K = {
  PASSCODE: 'glimpse_passcode',
  FAIL_COUNT: 'glimpse_fail_count',
};

export const getPasscode = () => SecureStore.getItemAsync(K.PASSCODE);
export const setPasscode = (code) => SecureStore.setItemAsync(K.PASSCODE, code);

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
    SecureStore.deleteItemAsync('glimpse_fake_passcode'),
  ]);
}
