// Project — repository state, sessions, the active change, context packs
// (plan §6.2). The place to start or resume an agent and open review.

import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel, PanelRow } from "@/components/panel";
import { Screen, ScreenHeader, SectionLabel } from "@/components/screen";
import { SessionRow } from "@/components/session-row";
import { BodyText, MonoText, UiText } from "@/components/typography";
import { changeStats, projectById, sessionsForProject } from "@/data/mock";

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const project = projectById(id);
  if (!project) {
    return (
      <Screen>
        <BodyText tone="muted">This project is not in the store.</BodyText>
      </Screen>
    );
  }
  const own = sessionsForProject(project.id);
  const unreviewed = own.filter((s) => s.change?.reviewed === false);

  return (
    <Screen>
      <ScreenHeader
        eyebrow="project"
        title={project.name}
        meta={`${project.storePath} · ${project.branch} @ ${project.headSha}`}
      />

      <SectionLabel>Sessions</SectionLabel>
      <Panel>
        {own.map((session, i) => (
          <SessionRow
            key={session.id}
            session={session}
            first={i === 0}
            onPress={() => router.push({ pathname: "/session/[id]", params: { id: session.id } })}
          />
        ))}
      </Panel>

      {unreviewed.length > 0 ? (
        <>
          <SectionLabel>Changes</SectionLabel>
          <Panel>
            {unreviewed.map((session, i) => (
              <PanelRow key={session.id} first={i === 0}>
                <View style={{ gap: 4 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                    }}
                  >
                    <MonoText tone="faint" size={11}>
                      worktree vs {project.branch}
                    </MonoText>
                    <MonoText tone="muted" size={11}>
                      {session.change ? changeStats(session.change) : ""}
                    </MonoText>
                  </View>
                  <UiText weight="medium" size={14.5} numberOfLines={2}>
                    {session.title}
                  </UiText>
                  <EvButton
                    label="Open review"
                    variant="ghost"
                    style={{ alignSelf: "flex-start", minHeight: 32, paddingHorizontal: 0 }}
                    onPress={() =>
                      router.push({ pathname: "/review/[id]", params: { id: session.id } })
                    }
                  />
                </View>
              </PanelRow>
            ))}
          </Panel>
        </>
      ) : null}

      <SectionLabel>Context packs</SectionLabel>
      <Panel>
        {project.contextPacks.map((pack, i) => (
          <PanelRow key={pack.name} first={i === 0}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <UiText size={14}>{pack.name}</UiText>
              <MonoText tone="faint" size={11.5}>
                {pack.items} items
              </MonoText>
            </View>
          </PanelRow>
        ))}
      </Panel>

      <EvButton label="New session" />
    </Screen>
  );
}
