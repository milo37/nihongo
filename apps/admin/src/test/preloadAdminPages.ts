/**
 * Imports every lazy admin page up front. A test that renders `adminRoutes`
 * otherwise pays the first import of its page (module transform and
 * evaluation) inside its first `findBy*` wait, which ran past the deadline
 * when the whole workspace test run kept every core busy. Call it from
 * `beforeAll` so that one-time cost falls under the hook timeout instead.
 */
export const preloadAdminPages = async (): Promise<void> => {
  await Promise.all([
    import('@app/admin-audit/page'),
    import('@app/admin-import/page'),
    import('@app/admin-member/page'),
    import('@app/admin-member/detail/page'),
    import('@app/admin-question/page'),
    import('@app/admin-question/create/page'),
    import('@app/admin-question/detail/page'),
    import('@app/admin-question/edit/page'),
    import('@app/admin-report/page'),
    import('@app/admin-report/detail/page')
  ])
}
