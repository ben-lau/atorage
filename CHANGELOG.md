# Changelog

## [0.0.4](https://github.com/ben-lau/atorage/compare/v0.0.3...v0.0.4) (2026-07-17)


### Features

* **core:** add peek() and remove cached middleware ([69ec037](https://github.com/ben-lau/atorage/commit/69ec037c167297a048886cfced73caede700babb))


### Code Refactoring

* **core:** make atoms independent and opt into sync via middleware ([22b53ee](https://github.com/ben-lau/atorage/commit/22b53ee1c03e531a7ebd624759ad6e212234f7cd))

## [0.0.3](https://github.com/ben-lau/atorage/compare/v0.0.2...v0.0.3) (2026-07-15)


### Bug Fixes

* **drivers:** support multiple IndexedDB stores on the same database ([f5ba3db](https://github.com/ben-lau/atorage/commit/f5ba3db1ae75b8a51259d432aaa8a2e2f4ea59a6))

## [0.0.2](https://github.com/ben-lau/atorage/compare/v0.0.1...v0.0.2) (2026-07-13)


### Features

* complete atorage library ([f45aa60](https://github.com/ben-lau/atorage/commit/f45aa603ce38b7da99693f8f0986b88a85d95978))
* implement Phase 1 core foundation ([c711d42](https://github.com/ben-lau/atorage/commit/c711d4241f8a06febd9e36c59e143f30b87daa8a))


### Bug Fixes

* **core:** harden API semantics and fix data integrity issues ([2bb54b4](https://github.com/ben-lau/atorage/commit/2bb54b432b60758aac8cb22b0c5e2a4267ae6fb6))
* **core:** improve error observability and fix docs-implementation mismatches ([661f8df](https://github.com/ben-lau/atorage/commit/661f8dfa1405522fce96a348bf15a3393ee4c266))
* **core:** improve per-key cache invalidation, error resilience and batch optimization ([4cb4c61](https://github.com/ben-lau/atorage/commit/4cb4c616cdbf43733fa46fd8cb829c846bcf658a))
* **core:** prevent ghost eventBus notifications across different drivers ([a45a96a](https://github.com/ben-lau/atorage/commit/a45a96a0ac91f1f8eeddd83e81af1e4008156a8f))
* **core:** skip stale cleanup for drivers sharing the same backend ([23e1c75](https://github.com/ben-lau/atorage/commit/23e1c75a0d0f649d9e494244d91b572be3894224))
* **core:** sync event bus with backendId and harden degradation UX ([d9d982d](https://github.com/ben-lau/atorage/commit/d9d982dbe0884748c86c537de8b00064f2ba2001))
* **middleware:** rework tabSync for shared instances and keyed routing ([ffae464](https://github.com/ben-lau/atorage/commit/ffae464d3e5ac59da749289fb79e5e02ffb0dcf6))


### Code Refactoring

* **core:** unify atom context/error/dispatch patterns and harden has() TTL path ([686556a](https://github.com/ben-lau/atorage/commit/686556afa030e1504fe731d6651138ddf4c42a41))
