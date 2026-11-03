# Python backend fixes included

This build fixes four issues:

1. Resume analysis now returns the exact `ResumeAnalysis` structure expected by the React scheduling page.
2. The React page normalizes older analysis responses so a missing field cannot crash the page.
3. PostgreSQL URLs are automatically converted to the `psycopg` SQLAlchemy driver, matching the installed `psycopg[binary]` package.
4. The dashboard exposes `needs_review` and counts both existing human-review outcomes (`Needs Review` and `Review`).

After replacing the files, restart both servers. No database reset is required because these changes use the existing schema.
