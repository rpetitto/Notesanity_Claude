/**
 * The plan table, and the one switch that says whether any of it applies yet.
 *
 * Three things read this file and must never disagree: the worker's plan gates,
 * the Checkout endpoint, and the static pricing page the marketing build
 * renders. Putting the numbers and the switch in one plain module that all
 * three import is what makes "the page says free, the server says free" a
 * property of the code rather than a thing to remember.
 *
 * BETA_FREE is that switch. While it is true, every gate in the worker is a
 * no-op, Checkout refuses to sell anything, and the pricing page shows the real
 * prices struck through. Flipping it is a product decision, not a deploy: the
 * pricing page promises schools a full semester's notice before anything costs
 * money, so the commit that sets this false lands at least a semester after
 * that notice goes out, and the same commit updates the changelog.
 */

export const BETA_FREE = true;

/** Class notebooks a Free teacher can have at once. Archived ones don't count. */
export const FREE_NOTEBOOK_LIMIT = 10;

/**
 * `seats`: how many people one purchase covers — null means everyone in the
 * school. `notebookLimit`: null means unlimited. `selfServe`: whether there is
 * a Checkout button, or a conversation and an invoice.
 */
export const PLANS = {
  free: {
    label: "Free", priceCents: 0, interval: "year", seats: 1,
    notebookLimit: FREE_NOTEBOOK_LIMIT, pageLibrary: false, schoolAdmin: false, selfServe: false,
  },
  pro: {
    label: "Pro", priceCents: 4900, interval: "year", seats: 1,
    notebookLimit: null, pageLibrary: true, schoolAdmin: false, selfServe: true,
  },
  department: {
    label: "Department", priceCents: 49900, interval: "year", seats: 20,
    notebookLimit: null, pageLibrary: true, schoolAdmin: false, selfServe: false,
  },
  school: {
    label: "School", priceCents: 99900, interval: "year", seats: null,
    notebookLimit: null, pageLibrary: true, schoolAdmin: true, selfServe: false,
  },
};

/** "$59" — one formatter, so the app and the static page can't round differently. */
export const dollars = (cents) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
