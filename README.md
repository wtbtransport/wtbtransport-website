# WTB Transport Corporate Website

Static company website for WTB Transport, deployed with Azure Static Web Apps.

## Quote request email delivery

The quote form posts to the Azure Functions API in `api/`, which sends requests through Azure Communication Services Email. Configure these application settings for the Static Web App:

- `ACS_CONNECTION_STRING`: connection string for the Azure Communication Services resource.
- `ACS_SENDER_ADDRESS`: sender address verified for that resource.
- `QUOTE_TO_EMAIL` (optional): destination inbox; defaults to `info@wtbtransport.com`.

Add these values under the Static Web App's environment variables in Azure. Do not commit credentials. The sender domain/address must be verified and enabled for email in Azure Communication Services.

Run the API unit tests with `cd api && npm ci && npm test`.
