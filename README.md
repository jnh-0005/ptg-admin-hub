# PTG Admin Hub

This archive contains the source code and public runtime assets for PTG Admin Hub.

## Local development

1. Install a supported Node.js version.
2. Run `npm install`.
3. Run `npm run dev` for local development.
4. Run `npm run build` for a production build.
5. Run `npm test` for automated tests.

The app uses Folk-hosted database endpoints at runtime. Deployment and environment-specific API credentials must be supplied through the hosting platform secret manager, never committed to this repository.

## Safety notes

The archive intentionally excludes dependency directories, build output, browser and QA artifacts, Git metadata, logs, local database files, environment files, credentials, live customer/order/payment data, raw payment QR assets and user-uploaded proof files.
