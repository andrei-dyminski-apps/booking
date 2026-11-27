/** Links shared by the notification formatter and the web navigation. */
export const notificationRoutes = {
  bookings: "/bookings",
  payouts: "/dashboard/payouts",
  adminPayments: "/admin/payments",
  booking: (id: string) => "/bookings/" + encodeURIComponent(id),
  conversation: (id: string) => "/messages/" + encodeURIComponent(id),
  listing: (id: string) => "/listings/" + encodeURIComponent(id),
  adminUser: (id: string) => "/admin/users/" + encodeURIComponent(id),
  guestReviews: (id: string) =>
    "/guests/" + encodeURIComponent(id) + "/reviews",
} as const;
