# Use the API with an AI agent

If you are building the integration with a coding agent, give it the brief. It is one markdown file with the rules that cause the most integration mistakes, the flow in order, and an index of every endpoint:

* **Brief for agents:** `https://contraflow.vercel.app/contraflow-api.md`
* **Index for agents (`llms.txt`):** `https://contraflow.vercel.app/llms.txt`
* **OpenAPI 3.1 document** (exact request and response bodies): `https://contraflow.vercel.app/api/v1/openapi.json`
* **These docs as one file:** `llms-full.txt` at the root of this site

## What the brief covers

* The scope of the API (offchain obligations only) and the rules an agent must not break: Contraflow never signs for anyone, secrets are never requested or logged, every `POST` carries an `Idempotency-Key`, and a certificate does not by itself discharge a debt.
* Authentication, scopes and permissions, rate limits and the error shape.
* The flow from permission to applied certificate, and how to sign the typed data correctly.
* Who pays gas for an apply, and how to update a customer's books from `certificate.applied`.
* Webhooks: registering an endpoint, verifying signatures, retries.
* An index of every operation and error code, generated from the API itself.

## How to use it

Paste the URL of `contraflow-api.md` into your agent's context, or save the file in your project (for example as `docs/contraflow-api.md`) and point your agent's instructions at it. Keep keys and webhook secrets in your secret manager and give the agent only the variable names. Run the whole loop on a test key before asking for a live one.

The brief is a summary. The [API reference](reference/api.md) is the full contract. The [quick start](quickstart.md) is a script the agent can run end to end on the network its key belongs to.
