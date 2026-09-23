import { WizardClient } from "./wizard-client";

/**
 * The new-habit shell — deliberately free of user data.
 *
 * It used to resolve `getAuthUser()` here and pass `user.id` into the markup.
 * That single field was enough to make the document un-cacheable: served to
 * the next person on the device it would have leaked one user's id, and worse,
 * the wizard would have created their habits under it. So the form could not
 * be cached, and could not be opened offline — even though the outbox behind
 * it has supported queueing a habit all along.
 *
 * `WizardClient` reads the id from the local session instead, so this markup
 * is identical for everyone and safe for the service worker to store. See
 * SHELL_DOCUMENTS in src/sw/service-worker.js.
 *
 * No auth check here: `src/proxy.ts` already redirects unauthenticated
 * `/main/*` requests, and `AuthGate` still gates the subtree. A `redirect()`
 * would also make the response `redirected`, which the worker refuses to cache.
 */
export default function NewHabitPage() {
  return <WizardClient />;
}
