// Notification taps land in the session they announce. Two paths (t3code's
// pattern, MIT — pingdotgg/t3code notificationNavigation): a live listener
// for taps while the app runs, and the cold-start read of the response that
// launched the app — deduped by response identifier so one tap never routes
// twice, and the cold-start response cleared so it can't replay on reload.

import * as Notifications from "expo-notifications";

export interface NotificationRouter {
  readonly push: (sessionId: string) => void;
}

const sessionIdOf = (response: Notifications.NotificationResponse): string | null => {
  const data: Record<string, unknown> | undefined = response.notification.request.content.data;
  const sessionId = data?.["sessionId"];
  return typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
};

export const wireNotificationNavigation = (router: NotificationRouter): (() => void) => {
  const handled = new Set<string>();
  const handle = (response: Notifications.NotificationResponse) => {
    if (handled.has(response.notification.request.identifier)) return;
    handled.add(response.notification.request.identifier);
    const sessionId = sessionIdOf(response);
    if (sessionId !== null) router.push(sessionId);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  void Notifications.getLastNotificationResponseAsync()
    .then((last) => {
      if (last === null) return;
      handle(last);
      return Notifications.clearLastNotificationResponseAsync();
    })
    .catch(() => undefined);
  return () => subscription.remove();
};

/** Foreground: the surface being watched is already on screen — list, no banner. */
export const configureForegroundPresentation = (): void => {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
};
