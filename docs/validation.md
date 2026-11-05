# Validation snapshot

Verified on 2026-11-05. The app is implemented and validated locally; live model generation remains pending credentials and account access.

## Completed

| Check                    | Evidence                                                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static validation        | ESLint, TypeScript, production Next.js build passed                                                                                                                               |
| Focused regression tests | Six passing tests: Seedance edit/reference contract, independent OpenAPI signing vector, duration and dimension constraints, unsafe download rejection, native TOS signed URLs    |
| Dependency audit         | No reported vulnerabilities in the installed dependency tree                                                                                                                      |
| Production API + worker  | Real Next.js standalone server, PostgreSQL 18 and FFmpeg worker; 42 checked HTTP/persistence observations                                                                         |
| Container API + worker   | Built Node 24 image, separate PostgreSQL database, actual web and worker containers; 43 checked observations                                                                      |
| Browser journeys         | Account creation, production login, both reference uploads, clip selection, job creation, visible missing-fal failure, refresh persistence, library, connection status and logout |
| Responsive UI            | Desktop 1440px, mobile 390px, and 320×568; no horizontal overflow, scrollable short-screen dialogs, accessible account controls                                                   |
| Final browser console    | Zero errors and warnings in the final production session                                                                                                                          |
| Secret handling          | Environment files ignored; server-only credentials; private file permissions                                                                                                      |

The API scripts use real HTTP requests and persisted database state. The worker performs actual FFmpeg trim, video normalization, first-frame extraction and audio preservation. Tests verify unauthorized access (401), foreign-origin mutations (403), cross-user media/jobs/approve/cancel isolation (404), invalid inputs (400), invalid approval state (409), saved history, cancellation and recovery from a persisted unconfirmed-submission marker.

The checked-observation count includes polling and can vary with worker timing. Runtime reports and screenshots are local QA artifacts under output/ and are intentionally excluded from Git. Smoke accounts and their files are removed by the script. Use a fresh disposable database for repeated runs because authentication rate-limit buckets persist.

Browser testing caught and fixed an unauthenticated background-request race during logout and a dialog height issue on short phones. Query reads consume TanStack's AbortSignal, logout cancels in-flight reads, and uploads abort on account changes.

## Live integration still required

| Prerequisite                                      | Remaining verification                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| User-provided fal.ai key and endpoint             | Confirm supplied schema, SAM tracking quality, masked-video output, polling and provider cancellation                  |
| TOS bucket and scoped access keys                 | Actual native TOS put/get/delete, encryption, signed reads from browser/fal/ModelArk and retrieval after cache loss    |
| Virtual Portrait access keys and eligible asset   | CreateAssetGroup/CreateAsset, review acceptance and Active transition                                                  |
| Seedance model entitlement                        | Submit the active video asset as reference_video, poll, retrieve the real generated result, restore audio and download |
| Verified Seedream 5.5 model/endpoint ID, optional | Multi-image request, reviewed scene image and downstream appearance consistency                                        |
| Hosting configuration                             | HTTPS origin, registration/invite policy, backups, retention and operational monitoring                                |

No image or video generation success is claimed. Contract tests and configured-key indicators do not prove provider entitlement, masked-asset acceptance or output quality. The optional Seedream branch stays disabled until a model ID is explicitly configured.

The production image packages web, migration and worker commands. A hosted deployment still needs an operator-selected container host and HTTPS reverse proxy. The local studio is available on port 3107.
