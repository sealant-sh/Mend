// Now — a sparse attention inbox (plan §6.1), fed by the LIVE workbench API:
// what is waiting for me, what runs, what recently settled. Not a kanban.

import { useRouter } from "expo-router";
import { View } from "react-native";

import { Panel } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { SessionRow } from "@/components/session-row";
import { Eyebrow, MonoText } from "@/components/typography";
import { ACTIVE, toSession, useAllSessions } from "@/data/live";
import { useEvidenceTheme } from "@/theme/evidence";

function GroupLabel({ label }: { readonly label: string }) {
  const { colors } = useEvidenceTheme();
  return (
    <View style={{ backgroundColor: colors.sunken, paddingHorizontal: 16, paddingVertical: 6 }}>
      <Eyebrow>{label}</Eyebrow>
    </View>
  );
}

export default function NowScreen() {
  const router = useRouter();
  const all = useAllSessions();
  const rows = (all.data ?? []).map(({ session, project }) => ({
    dto: session,
    view: toSession(session, project.name),
  }));

  const openSession = (id: string) => router.push({ pathname: "/session/[id]", params: { id } });

  const groups = [
    { label: "Needs you", items: rows.filter(({ dto }) => dto.status === "waiting") },
    {
      label: "Live",
      items: rows.filter(({ dto }) => dto.status !== "waiting" && ACTIVE.has(dto.status)),
    },
    {
      label: "Recently settled",
      items: rows.filter(({ dto }) => !ACTIVE.has(dto.status)).slice(0, 8),
    },
  ];

  return (
    <Screen topInset>
      <ScreenHeader
        eyebrow="mend"
        title="Now"
        meta={
          all.isError
            ? "server unreachable — check Settings"
            : all.isLoading
              ? "connecting…"
              : `${rows.length} sessions`
        }
      />
      {all.isError && (
        <Panel>
          <View style={{ padding: 16 }}>
            <MonoText>{String((all.error as Error | null)?.message ?? "error")}</MonoText>
          </View>
        </Panel>
      )}
      {groups.map(({ label, items }) =>
        items.length === 0 ? null : (
          <Panel key={label}>
            <GroupLabel label={label} />
            {items.map(({ view }) => (
              <SessionRow key={view.id} session={view} onPress={() => openSession(view.id)} />
            ))}
          </Panel>
        ),
      )}
    </Screen>
  );
}
