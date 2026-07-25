// One session, live: status, the REAL terminal (the same /api/tty WebSocket
// every surface uses, via the server's /tty-embed page), and the verbs —
// stop while it runs, resume when it settled. A session is work you rejoin.

import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { EvButton } from "@/components/button";
import { GhosttyTerminal } from "@/components/ghostty-terminal";
import { Panel } from "@/components/panel";
import { Screen, ScreenHeader } from "@/components/screen";
import { StatusWord } from "@/components/status";
import { MonoText } from "@/components/typography";
import { ACTIVE, loadConfig, toneOf, useSession, useSessionActions } from "@/data/live";
import { radius, useEvidenceTheme } from "@/theme/evidence";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useEvidenceTheme();
  const detail = useSession(id);
  const { resume, stop } = useSessionActions();
  const [base, setBase] = useState<{ url: string; token: string } | null>(null);
  useEffect(() => {
    void loadConfig().then((config) => setBase({ url: config.url, token: config.token }));
  }, []);

  const session = detail.data?.session;
  const active = session !== undefined && ACTIVE.has(session.status);
  const terminalReady = active && session?.sealantSessionId !== null && base !== null;

  return (
    <Screen>
      <ScreenHeader
        eyebrow="session"
        title={session?.harness ?? "session"}
        meta={session === undefined ? "loading…" : `${session.branch} · ${session.status}`}
      />
      {session !== undefined && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <StatusWord tone={toneOf(session.status)} word={session.status} />
          {active ? (
            <EvButton
              variant="outline"
              label={stop.isPending ? "stopping…" : "Stop"}
              onPress={() => stop.mutate(session.id)}
            />
          ) : (
            <EvButton
              label={resume.isPending ? "resuming…" : "Resume"}
              onPress={() => resume.mutate({ sessionId: session.id, harness: null })}
            />
          )}
        </View>
      )}
      {terminalReady ? (
        <Panel lift>
          <View style={{ height: 480, borderRadius: radius.xl, overflow: "hidden" }}>
            <GhosttyTerminal serverUrl={base.url} token={base.token} sessionId={session.id} />
          </View>
        </Panel>
      ) : (
        <Panel>
          <View style={{ padding: 16 }}>
            <MonoText>
              {session === undefined
                ? "loading…"
                : active
                  ? "provisioning workspace — the terminal attaches when the PTY is live…"
                  : (session.summary ?? "settled — resume to rejoin this work")}
            </MonoText>
          </View>
        </Panel>
      )}
      {session !== undefined && detail.data?.change != null && !active && (
        <EvButton
          variant="outline"
          label="Review the change"
          onPress={() =>
            router.push({ pathname: "/review/[id]", params: { id: detail.data?.change?.id ?? "" } })
          }
        />
      )}
    </Screen>
  );
}
