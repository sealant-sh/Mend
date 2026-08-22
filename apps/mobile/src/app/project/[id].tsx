// Project — repository state and its sessions, live (plan §6.2). The place
// to start an agent and step into any session. Context packs join when the
// context library ships (plan M3) — no mock stand-ins.

import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel, PanelRow } from "@/components/panel";
import { Screen, ScreenHeader, SectionLabel } from "@/components/screen";
import { SessionRow } from "@/components/session-row";
import { BodyText, MonoText } from "@/components/typography";
import {
  PROTOCOL_HARNESSES,
  annotationDetail,
  toSession,
  useProjectSessions,
  useSessionActions,
} from "@/data/live";

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const detail = useProjectSessions(id ?? null);
  const { start } = useSessionActions();
  const project = detail.data?.project;
  const sessions = detail.data?.sessions ?? [];

  if (detail.isError) {
    return (
      <Screen>
        <BodyText tone="muted">
          {String((detail.error as Error | null)?.message ?? "This project is not reachable.")}
        </BodyText>
      </Screen>
    );
  }
  if (project === undefined) {
    return (
      <Screen>
        <MonoText tone="faint">loading…</MonoText>
      </Screen>
    );
  }

  const fire = (harness: string) => {
    start.mutate(
      { projectId: project.id, harness },
      {
        onSuccess: (session) =>
          router.push({
            pathname: "/session/[id]",
            params: { id: session.id, mode: "protocol" },
          }),
      },
    );
  };

  return (
    <Screen>
      <ScreenHeader
        eyebrow="project"
        title={project.name}
        meta={`${project.defaultBranch}${project.adoptedSha === null ? "" : ` @ ${project.adoptedSha.slice(0, 7)}`}`}
      />

      <SectionLabel>Start a session</SectionLabel>
      <Panel>
        <PanelRow first>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {PROTOCOL_HARNESSES.map((harness) => (
              <EvButton
                key={harness}
                variant="outline"
                label={start.isPending ? "…" : harness}
                disabled={start.isPending}
                onPress={() => fire(harness)}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        </PanelRow>
      </Panel>

      <SectionLabel>Sessions</SectionLabel>
      <Panel>
        {sessions.length === 0 ? (
          <PanelRow first>
            <MonoText tone="faint">no sessions yet — start one above</MonoText>
          </PanelRow>
        ) : (
          sessions.map((session, index) => (
            <SessionRow
              key={session.id}
              session={toSession(session, project.name)}
              detail={annotationDetail(
                detail.data?.annotations.find((row) => row.sessionId === session.id),
                session.summary,
              )}
              first={index === 0}
              onPress={() => router.push({ pathname: "/session/[id]", params: { id: session.id } })}
            />
          ))
        )}
      </Panel>
    </Screen>
  );
}
