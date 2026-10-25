/*
 * stepcast used a service worker for a while (to isolate the page for speech
 * to text, now gone). This one only removes itself for visitors who still
 * have it: it unregisters, and reloads the pages it controlled so they load
 * straight from the network again.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration.unregister().then(async () => {
      for (const client of await self.clients.matchAll({ type: "window" }))
        client.navigate(client.url);
    }),
  );
});
