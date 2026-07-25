// Projects — repositories adopted into the machine's central store (plan §5.2).

import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { MonoText, UiText } from "@/components/typography";
import type { Project } from "@/data/mock";
import { projects, sessionsForProject } from "@/data/mock";
import { useEvidenceTheme } from "@/theme/evidence";

function ProjectRow({
  project,
  first,
  onPress,
}: {
  readonly project: Project;
  readonly first: boolean;
  readonly onPress: () => void;
}) {
  const { colors } = useEvidenceTheme();
  const own = sessionsForProject(project.id);
  const running = own.filter((s) => s.state === "running" || s.state === "waiting").length;
  const unreviewed = own.filter((s) => s.change?.reviewed === false).length;
  const meta = [
    `${project.branch} @ ${project.headSha}`,
    `${own.length} sessions`,
    ...(running > 0 ? [`${running} active`] : []),
    ...(unreviewed > 0 ? [`${unreviewed} change unreviewed`] : []),
  ].join(" · ");
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
          ...(first
            ? {}
            : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.faintRule }),
        },
        pressed && { backgroundColor: colors.sunken },
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <UiText weight="semibold" size={15}>
          {project.name}
        </UiText>
        <MonoText tone="muted" size={11.5}>
          {meta}
        </MonoText>
      </View>
      <ChevronRight color={colors.faint} size={16} strokeWidth={1.8} />
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const router = useRouter();
  return (
    <Screen topInset>
      <ScreenHeader
        eyebrow="central store"
        title="Projects"
        meta={`${projects.length} adopted · ~/.mend/store`}
      />
      <Panel>
        {projects.map((project, i) => (
          <ProjectRow
            key={project.id}
            project={project}
            first={i === 0}
            onPress={() => router.push({ pathname: "/project/[id]", params: { id: project.id } })}
          />
        ))}
      </Panel>
      <EvButton label="Adopt a repository" variant="outline" />
    </Screen>
  );
}
