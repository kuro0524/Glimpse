import { useRef, useEffect, useState } from 'react';
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

const Stack = createNativeStackNavigator();

export default function App() {
  const navigationRef = useNavigationContainerRef();
  const appState = useRef(AppState.currentState);
  const [showPrivacyScreen, setShowPrivacyScreen] = useState(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      const prev = appState.current;
      if (prev === 'background' && nextState === 'active') {
        if (navigationRef.isReady()) {
          navigationRef.reset({ index: 0, routes: [{ name: 'Lock' }] });
        }
      }
      setShowPrivacyScreen(nextState !== 'active');
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [navigationRef]);

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
            <Stack.Screen name="Fake" component={FakeView} options={{ headerShown: false, gestureEnabled: false }} />
          </Stack.Navigator>
        </NavigationContainer>
        {showPrivacyScreen && <View style={styles.privacyScreen} />}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  privacyScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1C1C1E',
  },
});
