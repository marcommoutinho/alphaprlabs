// Complete reads past the API's 1,000-row cap, a page at a time by keyset:
// each page asks for the rows after the last one read, in key order, so a
// row written or deleted between two pages can never make an existing row
// repeat or go missing (as offset paging would: every later row shifts).
// Callers sort the result into the order they show.

/** Rows per request; the API caps a response at 1,000 rows. */
export const API_PAGE = 1000;

/**
 * How a read is paged; for tests. `pageSize` is capped at the API's 1,000.
 * `afterPage` runs after each full page is read and before the next is asked
 * for (tests write between pages with it); `what` names the collection.
 */
export type PageOptions = { pageSize?: number; afterPage?: (what: string, page: number) => Promise<void> | void };

type PageResult<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/**
 * Every row `page` returns, where `page(after, limit)` asks for at most
 * `limit` rows ordered by a unique key and strictly after `after` (the last
 * row read; null for the first page).
 */
export async function keysetRows<Row>(
  page: (after: Row | null, limit: number) => PageResult<Row>,
  what: string,
  options: PageOptions = {},
): Promise<Row[]> {
  // Never more than the API returns: a short page must mean the last one.
  const pageSize = Math.min(options.pageSize ?? API_PAGE, API_PAGE);
  const rows: Row[] = [];
  for (let after: Row | null = null, pages = 1; ; pages += 1) {
    const { data, error } = await page(after, pageSize);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
    after = got[got.length - 1];
    await options.afterPage?.(what, pages);
  }
}

/**
 * The PostgREST filter for rows after `(first, second)` in (first, second)
 * order, for a two-column key. Values are uuids, dates or numbers here, never
 * free text, so they need no quoting.
 */
export const afterPair = (firstColumn: string, first: string, secondColumn: string, second: string) =>
  `${firstColumn}.gt.${first},and(${firstColumn}.eq.${first},${secondColumn}.gt.${second})`;
