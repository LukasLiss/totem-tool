# End-to-end smoke tests (Playwright)

`assistant.spec.ts` drives the real app in a browser: it opens the AI assistant,
sends a message, waits for the tool chip and the answer, expands the chip, and
sends a follow-up. It uses the offline **demo provider** (`totem_llm_provider =
demo` in localStorage), so no API key or network LLM is needed.

## Run it

1. Backend on :8000 in local mode (from the repo root):

   ```bash
   cd backend && LOCAL_MODE=1 .venv/bin/python manage.py runserver 8000
   ```

2. Frontend on :3000 in local mode:

   ```bash
   cd frontend && VITE_LOCAL_MODE=1 npx vite --port 3000 --strictPort
   ```

3. Run the tests:

   ```bash
   cd frontend && npm run test:e2e
   ```

If either server is not already running, `npm run test:e2e` starts it itself
(the backend from `backend/.venv`; set `E2E_BACKEND_PYTHON` to use another
interpreter). Set `E2E_NO_SERVER=1` to never start servers, and `E2E_BASE_URL`
to point at a different frontend URL.

### Browser

Playwright uses its own Chromium build. Install it once with:

```bash
cd frontend && npx playwright install chromium
```

or skip the download and use the Google Chrome already on the machine:

```bash
cd frontend && PW_CHANNEL=chrome npm run test:e2e
```

Failure traces and screenshots land in `frontend/e2e/.results/` (git-ignored);
open a trace with `npx playwright show-trace <path>/trace.zip`.
