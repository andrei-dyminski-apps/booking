"use client";

import dynamic from "next/dynamic";

// Loaded only once a session renders them: imported statically, the popover, Floating UI
// and the notification code were part of every visitor's first load, signed in or not.
// `dynamic()` splits only inside a Client Component — called from the server header, the
// chunks stayed in the route's initial set — which is the whole reason this file exists.
const NotificationBell = dynamic(() =>
  import("./notification-bell").then((module) => module.NotificationBell),
);
const NotificationToasts = dynamic(() =>
  import("./notification-toasts").then((module) => module.NotificationToasts),
);

/** The bell and the toasts of an account, which the header renders for a session only. */
export const AccountNotifications = () => (
  <>
    <NotificationBell />
    <NotificationToasts />
  </>
);
