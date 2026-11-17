import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { getDb } from './src/db/database';
import HomeScreen from './src/screens/HomeScreen';
import WorkoutFormScreen from './src/screens/WorkoutFormScreen';
import WorkoutDetailScreen from './src/screens/WorkoutDetailScreen';
import PoseAnalysisScreen from './src/screens/PoseAnalysisScreen';
import SyncScreen from './src/screens/SyncScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const headerStyle = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

function WorkoutsStack() {
  return (
    <Stack.Navigator screenOptions={headerStyle}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'CheckFit' }} />
      <Stack.Screen name="WorkoutForm" component={WorkoutFormScreen} options={{ title: 'Novo treino' }} />
      <Stack.Screen name="WorkoutDetail" component={WorkoutDetailScreen} options={{ title: 'Treino' }} />
      <Stack.Screen name="PoseAnalysis" component={PoseAnalysisScreen} options={{ title: 'Análise de postura' }} />
    </Stack.Navigator>
  );
}

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.primary, border: colors.border },
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [dbError, setDbError] = useState(null);

  useEffect(() => {
    // cria as tabelas do SQLite antes de abrir o app
    getDb()
      .then(() => setReady(true))
      .catch((e) => setDbError(e?.message || String(e)));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {dbError ? (
          <Text style={{ color: colors.danger, textAlign: 'center' }}>
            Não foi possível abrir o banco local (SQLite).{'\n'}{dbError}
          </Text>
        ) : (
          <ActivityIndicator color={colors.primary} size="large" />
        )}
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={({ route }) => ({
            ...headerStyle,
            tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.muted,
            tabBarIcon: ({ color, size }) => {
              const icons = { WorkoutsTab: 'barbell', SyncTab: 'cloud-done', ProfileTab: 'person' };
              return <Ionicons name={icons[route.name]} size={size} color={color} />;
            },
          })}
        >
          <Tab.Screen name="WorkoutsTab" component={WorkoutsStack} options={{ title: 'Treinos', headerShown: false }} />
          <Tab.Screen name="SyncTab" component={SyncScreen} options={{ title: 'Sincronizar' }} />
          <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: 'Perfil' }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
