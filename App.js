import { useRef, useEffect, useState, useCallback } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LockView from './src/screens/LockView';
import AlbumListView from './src/screens/AlbumListView';
import AlbumDetailView from './src/screens/AlbumDetailView';
import PhotoViewerView from './src/screens/PhotoViewerView';
import SettingsView from './src/screens/SettingsView';
import FakeView from './src/screens/FakeView';
import BackupRestoreView from './src/screens/BackupRestoreView';
import TrashView from './src/screens/TrashView';
import * as db from './src/utils/db';

const Stack = createNativeStackNavigator();

export default function App() {
  const navigationRef = useNavigationContainerRef();
  const appState = useRef(AppState.currentState);
  const [showPrivacyOverlay, setShowPrivacyOverlay] = useState(true);
  const [showLockOverlay, setShowLockOverlay] = useState(true);
  // 'lock' | 'restore'
  const [lockOverlayContent, setLockOverlayContent] = useState('lock');

  // Silent, best-effort trash cleanup. Fire-and-forget so it never delays the
  // launch sequence or foreground resume — errors are swallowed intentionally.
  useEffect(() => {
    db.purgeExpiredTrash().catch(() => {});
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      const prev = appState.current;
      if (nextState !== 'active') {
        setShowPrivacyOverlay(true);
      } else if (prev === 'background') {
        setShowLockOverlay(true);
        setLockOverlayContent('lock');
      } else {
        setShowPrivacyOverlay(false);
      }
      if (nextState === 'active' && prev !== 'active') {
        db.purgeExpiredTrash().catch(() => {});
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, []);

  function handleAuthenticated() {
    setShowPrivacyOverlay(false);
    setShowLockOverlay(false);
    setLockOverlayContent('lock');
    if (navigationRef.isReady()) {
      navigationRef.reset({ index: 0, routes: [{ name: 'AlbumList' }] });
    }
  }

  const handleRestoreComplete = useCallback(() => {
    // After restore, recovery key is in SecureStore but no passcode.
    // LockView will detect this and show SETUP phase.
    setLockOverlayContent('lock');
  }, []);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer ref={navigationRef}>
          <StatusBar style="light" />
          <Stack.Navigator
            initialRouteName="Lock"
            screenOptions={{
              headerStyle: { backgroundColor: '#1C1C1E' },
              headerTintColor: '#EBEBF5',
              headerTitleStyle: { fontWeight: '600', fontSize: 17, color: '#EBEBF5' },
              contentStyle: { backgroundColor: '#1C1C1E' },
              animation: 'fade',
            }}
          >
            <Stack.Screen name="Lock" component={LockView} options={{ headerShown: false }} />
            <Stack.Screen name="AlbumList" component={AlbumListView} options={{ title: 'アルバム', headerBackVisible: false }} />
            <Stack.Screen name="AlbumDetail" component={AlbumDetailView} options={{ title: 'アルバム' }} />
            <Stack.Screen name="PhotoViewer" component={PhotoViewerView} options={{ headerShown: false }} />
            <Stack.Screen name="Settings" component={SettingsView} options={{ title: '設定' }} />
            <Stack.Screen name="Trash" component={TrashView} options={{ title: '削除済み' }} />
            <Stack.Screen name="Fake" component={FakeView} options={{ headerShown: false, gestureEnabled: false }} />
            <Stack.Screen
              name="BackupRestore"
              component={BackupRestoreView}
              options={{ headerShown: false }}
            />
          </Stack.Navigator>
        </NavigationContainer>

        {/* Privacy screen */}
        {showPrivacyOverlay && <View style={styles.overlay} pointerEvents="none" />}

        {/* Lock overlay */}
        {showLockOverlay && (
          <View style={styles.overlay}>
            {lockOverlayContent === 'restore' ? (
              <BackupRestoreView
                mode="restore"
                onRestoreComplete={handleRestoreComplete}
                onGoBack={() => setLockOverlayContent('lock')}
                navigation={null}
                route={null}
              />
            ) : (
              <LockView
                onAuthenticated={handleAuthenticated}
                onNavigateRestore={() => setLockOverlayContent('restore')}
                route={{}}
                navigation={null}
              />
            )}
          </View>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1C1C1E',
  },
});
