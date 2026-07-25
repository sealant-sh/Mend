import { Tabs } from "expo-router";
import { FolderGit2, Inbox, Settings } from "lucide-react-native";

import { fontFamilies, useEvidenceTheme } from "@/theme/evidence";

export default function TabsLayout() {
  const { colors } = useEvidenceTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.panel,
          borderTopColor: colors.softRule,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilies.sans.medium,
          fontSize: 10.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Now",
          tabBarIcon: ({ color }) => <Inbox color={color} size={22} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color }) => <FolderGit2 color={color} size={22} strokeWidth={1.8} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Settings color={color} size={22} strokeWidth={1.8} />,
        }}
      />
    </Tabs>
  );
}
