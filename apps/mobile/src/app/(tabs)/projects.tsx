// Projects — every adopted repo: start a session in place, and every
// existing session right there, tappable. Same verbs as web and CLI.

import { useRouter } from "expo-router";
import { View } from "react-native";

import { EvButton } from "@/components/button";
import { Panel, PanelRow } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { SessionRow } from "@/components/session-row";
import { MonoText, UiText } from "@/components/typography";
import { toSession, useAllSessions, useProjects, useSessionActions } from "@/data/live";

const HARNESSES = ["claude", "codex", "opencode"] as const;

export default function ProjectsScreen() {
  const router = useRouter();
  const projects = useProjects();
  const all = useAllSessions();
  const { start } = useSessionActions();

  const fire = (projectId: string, harness: string) => {
    start.mutate(
      { projectId, harness },
      {
        onSuccess: (session) =>
          router.push({ pathname: "/session/[id]", params: { id: session.id } }),
      },
    );
  };

  return (
    <Screen topInset>
      <ScreenHeader
        eyebrow="mend"
        title="Projects"
        meta={`${projects.data?.length ?? 0} adopted`}
      />
      {(projects.data ?? []).map((project) => {
        const sessions = (all.data ?? [])
          .filter(({ session }) => session.projectId === project.id)
          .slice(0, 8);
        return (
          <Panel key={project.id}>
            <PanelRow first>
              <View style={{ gap: 4 }}>
                <UiText weight="medium">{project.name}</UiText>
                <MonoText>
                  {project.defaultBranch}
                  {project.adoptedSha === null ? "" : `@${project.adoptedSha.slice(0, 7)}`}
                </MonoText>
              </View>
            </PanelRow>
            <PanelRow>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {HARNESSES.map((harness) => (
                  <EvButton
                    key={harness}
                    variant="outline"
                    label={start.isPending ? "…" : harness}
                    onPress={() => fire(project.id, harness)}
                    style={{ flex: 1 }}
                  />
                ))}
              </View>
            </PanelRow>
            {sessions.map(({ session }) => (
              <SessionRow
                key={session.id}
                session={toSession(session, project.name)}
                onPress={() =>
                  router.push({ pathname: "/session/[id]", params: { id: session.id } })
                }
              />
            ))}
          </Panel>
        );
      })}
    </Screen>
  );
}
