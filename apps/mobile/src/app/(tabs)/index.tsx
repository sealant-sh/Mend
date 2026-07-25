// Now — a sparse attention inbox (plan §6.1): what is waiting for me, what is
// ready to review, what is running, what recently finished. Not a kanban.

import { useRouter } from "expo-router";
import { View } from "react-native";

import { Panel } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { SessionRow } from "@/components/session-row";
import { Eyebrow } from "@/components/typography";
import type { Session } from "@/data/mock";
import { machine, sessions } from "@/data/mock";
import { useEvidenceTheme } from "@/theme/evidence";

// The group label sits inside the panel on the sunken bar, like the stage
// bars in the reference mocks — a label on a surface, not a decorated chip.
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

  const openSession = (session: Session) =>
    router.push({ pathname: "/session/[id]", params: { id: session.id } });
  const openReview = (session: Session) =>
    router.push({ pathname: "/review/[id]", params: { id: session.id } });

  const groups: ReadonlyArray<{
    readonly label: string;
    readonly items: ReadonlyArray<Session>;
    readonly open: (session: Session) => void;
  }> = [
    { label: "Needs you", items: sessions.filter((s) => s.state === "waiting"), open: openSession },
    {
      label: "Ready to review",
      items: sessions.filter((s) => s.state === "completed" && s.change?.reviewed === false),
      open: openReview,
    },
    { label: "Active", items: sessions.filter((s) => s.state === "running"), open: openSession },
    {
      label: "Recently finished",
      items: sessions.filter((s) => s.state === "completed" && s.change?.reviewed !== false),
      open: openSession,
    },
  ];

  return (
    <Screen topInset>
      <ScreenHeader
        eyebrow="mend"
        title="Now"
        meta={`${machine.name} · ${machine.reachable ? "reachable" : "unreachable"} · ${sessions.length} sessions`}
      />
      {groups.map(({ label, items, open }) =>
        items.length === 0 ? null : (
          <Panel key={label}>
            <GroupLabel label={label} />
            {items.map((session) => (
              <SessionRow key={session.id} session={session} onPress={() => open(session)} />
            ))}
          </Panel>
        ),
      )}
    </Screen>
  );
}
