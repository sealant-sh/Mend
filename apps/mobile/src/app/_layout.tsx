import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

import {
  configureForegroundPresentation,
  wireNotificationNavigation,
} from "@/data/notification-navigation";
import { fontFamilies, useEvidenceTheme } from "@/theme/evidence";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

SplashScreen.preventAutoHideAsync();
configureForegroundPresentation();

export default function RootLayout() {
  const { scheme, colors } = useEvidenceTheme();
  const router = useRouter();
  useEffect(
    () =>
      wireNotificationNavigation({
        push: (sessionId) => router.push({ pathname: "/session/[id]", params: { id: sessionId } }),
      }),
    [],
  );
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.bg,
      card: colors.panel,
      text: colors.ink,
      border: colors.softRule,
      notification: colors.accent,
    },
  };

  return (
    <KeyboardProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={navTheme}>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerShadowVisible: false,
              headerTintColor: colors.accent,
              headerTitleStyle: {
                fontFamily: fontFamilies.sans.semibold,
                fontSize: 15,
                color: colors.ink,
              },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="project/[id]" options={{ title: "Project" }} />
            <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
            <Stack.Screen name="review/[id]" options={{ title: "Review" }} />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </KeyboardProvider>
  );
}
