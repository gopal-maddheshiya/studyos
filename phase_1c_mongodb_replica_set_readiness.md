# StudyOS — MongoDB Replica Set Readiness Audit & Integration Strategy

**Document Status:** Comprehensive Read-Only Audit & Setup Architecture  
**Author:** Antigravity AI  
**Scope:** Windows Development Environment & MongoDB Transaction Readiness  
**Target:** Safe Single-Node Replica Set Deployment for Real ACID Integration Testing  

---

## Executive Summary

During the Phase 1C audit, real database-level verification of MongoDB transactions was marked **NOT VERIFIED** due to a local connection failure (`ECONNREFUSED 127.0.0.1:27017`).

This read-only inspection was conducted to ascertain the exact state of the local MongoDB environment, safeguard existing databases, evaluate deployment options, and architect a strategy for genuine multi-document transaction and concurrency integration testing.

### Key Audit Findings
1. **MongoDB Server Status:** Community Server `mongod.exe` is **NOT currently installed or active**. While previous server data and logs from MongoDB Community `8.0.4` exist on disk, the `bin` folder containing the server executable has been removed, and no Windows service is registered.
2. **MongoDB Client Utilities:** Modern MongoDB Shell (`mongosh` v2.3.8.0), MongoDB Database Tools (`100.11.0`), and MongoDB Compass (`1.49.7`) are **fully installed and available**.
3. **Port Status:** TCP port `27017` is completely **unoccupied and available**.
4. **Existing Data Safety Risk (CRITICAL):** The folder `C:\Program Files\MongoDB\Server\8.0\data` contains historical WiredTiger data files from other projects (`Nestora`, `wanderlust`, `whatsapp`, `student`, etc.). **This directory must NOT be overwritten, wiped, or used as the replica set path without strict isolation.**
5. **StudyOS Configuration:** Currently has no `.env` file and defaults to `mongodb://localhost:27017/studyos` with a 3000ms selection timeout.
6. **Recommendation:** Deploy a **Local Single-Node Replica Set (Option A)** using a fresh, dedicated data directory (`C:\data\studyos_rs\db`) to ensure 100% data safety, $0 cost, offline capability, sub-millisecond test latency, and zero risk to existing project databases.

---

## 1. Environment & MongoDB Installation Audit

A comprehensive probe of the Windows operating system and filesystem was performed:

| Component | Status | Detected Path / Version | Details |
| :--- | :--- | :--- | :--- |
| **`mongod` (Server)** | **Not Available in PATH** | Missing `bin/` | `C:\Program Files\MongoDB\Server\8.0` exists, but only contains `data` and `log`. Executable `mongod.exe` is absent. |
| **`mongosh` (Shell)** | **Installed** | `C:\Users\hp\AppData\Local\Programs\mongosh\mongosh.exe` | Version: **2.3.8.0** |
| **`mongo` (Legacy Shell)** | **Not Installed** | None | Superseded by `mongosh`. |
| **Database Tools** | **Installed** | `C:\Program Files\MongoDB\Tools\100\bin` | Version: **100.11.0** (`bsondump`, `mongodump`, `mongorestore`, etc.) |
| **MongoDB Compass** | **Installed** | `C:\Users\hp\AppData\Local\MongoDBCompass` | Version: **1.49.7** |
| **Historical Server Version**| **Identified from Logs** | `8.0.4` (Build: `bc35ab4305d9920d9d0491c1c9ef9b72383d31f9`) | Logged in `C:\Program Files\MongoDB\Server\8.0\log\mongod.log` before shutdown on 2026-08-18. |
| **Windows Service** | **Not Registered** | None | `Get-Service *mongo*` and Registry `HKLM:\SYSTEM\CurrentControlSet\Services` contain 0 MongoDB entries. |
| **TCP Port 27017** | **Free / Unoccupied** | Localhost:27017 | `Get-NetTCPConnection` and `netstat -ano` confirm no active listeners. |
| **Configuration File** | **Missing** | None | `mongod.cfg` was deleted alongside the server binary. |

---

## 2. StudyOS Configuration Inspection

### Connection Parameters (Redacted)
Inspection of `server/src/config/db.ts` and `server/src/config/env.ts` revealed:

```ts
// server/src/config/env.ts
MONGODB_URI: z.string().default('mongodb://[HOST]:27017/[DB_NAME]')
// Resolved Default: mongodb://localhost:27017/studyos
```

```ts
// server/src/config/db.ts
mongoose.set('strictQuery', true);
await mongoose.connect(env.MONGODB_URI, {
  serverSelectionTimeoutMS: 3000,
});
```

### Environment Variables
- **Repository `.env` status:** No `.env` file exists in either `server/` or the project root.
- **Runtime behavior:** In development, when `process.env.MONGODB_URI` is omitted, Zod defaults to `mongodb://localhost:27017/studyos`. If connection fails, `connectDB()` logs a warning and avoids crashing immediately in dev mode.

---

## 3. Existing Database Safety & Forensic Findings

### Critical Data Safety Alert
Forensic inspection of `C:\Program Files\MongoDB\Server\8.0\data` revealed 44 WiredTiger tables (`collection-*.wt`, `index-*.wt`, `WiredTiger.turtle`, `storage.bson`).

Log inspection of `mongod.log` confirmed the presence of user collections:
- `Nestora.listings`
- `wanderlust.listings`
- `whatsapp.chats`
- `amazone.books`
- `student.academics`
- `school.students`
- `shop.products`

**Crucial Finding:**
1. There is **no StudyOS database** in this directory.
2. However, this directory contains **live or historical user data from previous projects**.
3. Re-installing MongoDB and initializing a replica set using this default directory without caution could result in:
   - Data corruption.
   - Unintended replica-set re-configuration of existing storage tables.
   - Accidental loss of historical collections during test cleanups.

**Invariant Rule:**
> **All StudyOS development and replica-set testing MUST use a strictly isolated database directory (e.g. `C:\data\studyos_rs\db`). The existing directory `C:\Program Files\MongoDB\Server\8.0\data` must remain untouched as a protected historical volume.**

---

## 4. Evaluation of Setup Options

| Evaluation Vector | Option A: Local Single-Node Replica Set | Option B: MongoDB Atlas (Free M0 / M10) |
| :--- | :--- | :--- |
| **Setup Complexity** | **Low-to-Medium:** Install Community Server 8.0 MSI (uncheck Compass), configure `mongod.cfg` with `replication.replSetName: rs0`, and run `rs.initiate()`. | **Medium:** Requires cloud account creation, project setup, database user creation, IP access list (`0.0.0.0/0` or dynamic ISP IP updates), and TLS connection string management. |
| **Cost** | **$0.00:** 100% Free, local open-source software. | **$0.00** for M0 sandbox, but limited to 512 MB and 500 connections; subject to cloud throttling. |
| **Development Convenience** | **Highest:** Fully offline-capable; zero dependency on broadband; instant startup; no network latency. | **Moderate:** Requires continuous active internet connection; dynamic home/office IPs break connection unless open to `0.0.0.0/0`. |
| **Data Privacy** | **100% Local:** No user telemetry or student information leaves the developer workstation. | **Third-Party Cloud:** Data hosted on external cloud infrastructure (AWS/GCP/Azure). |
| **Test Reproducibility & Latency** | **Sub-millisecond:** Concurrency tests (e.g. 50 parallel transaction rollbacks) execute in milliseconds without network timeouts or rate limits. | **High Latency (30–150ms round-trip):** Concurrent transaction stress tests may experience network timeouts, socket exhaustion, or TLS handshake latency. |
| **Replica Set / Transaction Support** | **Full:** Supports WiredTiger multi-document transactions, write conflicts, rollbacks, and change streams. | **Full:** Supported on replica set clusters. |

### Recommendation
**Option A (Local Single-Node Replica Set)** is strongly recommended for development and automated integration testing. It provides deterministic, zero-latency testing, protects external bandwidth, and ensures full privacy.

Option B is suitable for remote staging or multi-developer team deployments.

---

## 5. Implementation Guide: Local Single-Node Replica Set (Option A)

Follow these exact steps when ready to activate the local replica set environment:

### Step 1: Install MongoDB Community Server 8.0
1. Download MongoDB Community Server 8.0 MSI (x64) for Windows from the official MongoDB Download Center.
2. Run the installer:
   - Choose **Complete** installation.
   - Select **"Run MongoDB as a Service"**.
   - **Crucial:** In the installer screen for Compass, **uncheck "Install MongoDB Compass"** (Compass v1.49.7 is already installed on this machine).

### Step 2: Establish Isolated Directory Structure
To safeguard historical data, create a dedicated data and log path:
```powershell
New-Item -ItemType Directory -Force -Path "C:\data\studyos_rs\db"
New-Item -ItemType Directory -Force -Path "C:\data\studyos_rs\log"
```

### Step 3: Configure `mongod.cfg` with Replication
Create or update `C:\Program Files\MongoDB\Server\8.0\bin\mongod.cfg` (or `C:\data\studyos_rs\mongod.cfg`):
```yaml
systemLog:
  destination: file
  path: C:\data\studyos_rs\log\mongod.log
  logAppend: true
storage:
  dbPath: C:\data\studyos_rs\db
  journal:
    enabled: true
net:
  bindIp: 127.0.0.1
  port: 27017
replication:
  replSetName: rs0
```

### Step 4: Start MongoDB Service
```powershell
# If registered as Windows Service:
Start-Service -Name MongoDB

# OR run directly via PowerShell in dev mode:
& "C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe" --config "C:\data\studyos_rs\mongod.cfg"
```

### Step 5: Initialize the Replica Set
Using the already-installed `mongosh`:
```powershell
& "C:\Users\hp\AppData\Local\Programs\mongosh\mongosh.exe" --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })"
```

Verify status:
```powershell
& "C:\Users\hp\AppData\Local\Programs\mongosh\mongosh.exe" --eval "rs.status().ok"
# Expected output: 1
```

### Step 6: Configure StudyOS Connection
Create `server/.env`:
```env
PORT=5001
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/studyos?replicaSet=rs0
```

---

## 6. Real MongoDB Integration Test Strategy

The test suite must be strictly structured into three distinct tiers:

```
[ Tier 1: Unit & Algorithm Simulators ] (In-memory, zero DB dependency, fast)
                   ↓
[ Tier 2: Mongoose Schema Validation ] (In-memory Mongoose model constraints)
                   ↓
[ Tier 3: Real MongoDB Replica Set Integration ] (Live WiredTiger ACID & Concurrency)
```

### Tier Separation

| Tier | File / Suite | Database Required | Proves | Does NOT Prove |
| :--- | :--- | :--- | :--- | :--- |
| **Tier 1** | `group1Hardening.test.ts` (Sections 1B, 4B, 10) | None (In-Memory Mocks) | Business logic state machine, retry loops, error code routing, and grace window policy. | Does **NOT** prove database-level ACID transactions, rollback on process crash, or WiredTiger locks. |
| **Tier 2** | `group1Hardening.test.ts` (Sections 5, 7) | None (Mongoose models) | Runtime schema validation, discriminator enforcement, subdocument rejection. | Does **NOT** prove unique compound index uniqueness or multi-document consistency. |
| **Tier 3** | `realMongoIntegration.test.ts` (New Suite) | **Live MongoDB Replica Set** | Genuine MongoDB session rollback, WriteConflict resolution, transaction aborts, and index constraints. | N/A (Authoritative database verification). |

---

### Tier 3 Test Specifications (`realMongoIntegration.test.ts`)

Create a dedicated integration test suite at `server/src/tests/realMongoIntegration.test.ts` executing the following five critical scenarios against the live replica set:

#### Test 1: Refresh-Token Transaction Atomic Rollback
- **Scenario:** Perform a refresh-token rotation where `predecessor.findOneAndUpdate` succeeds inside a `session.withTransaction()`, but an unhandled exception or deliberate failure is triggered prior to commit.
- **Verification:**
  1. Transaction aborts.
  2. Query predecessor in MongoDB without session: `revokedAt` is `null`, `replacedBySessionId` is `null`, and `revocationReason` is `null`.
  3. Query successor in MongoDB: Document count is `0`.
  4. Proves database-level atomicity.

#### Test 2: Concurrent Refresh Rotation (Race Condition Stress Test)
- **Scenario:** Fire 10 simultaneous HTTP/function calls presenting the exact same unrevoked refresh token against real MongoDB.
- **Verification:**
  1. Exactly **1** transaction succeeds and commits a successor.
  2. Losing transactions encounter `WriteConflict` or condition failure and safely fall back to the grace window policy.
  3. Total sessions in the family in MongoDB equals exactly **2** (Predecessor + 1 Successor).
  4. Zero session branching in real database storage.

#### Test 3: Multi-Document Revision Completion Rollback
- **Scenario:** Complete a revision that mutates 4 collections inside one transaction:
  1. `RevisionSchedule` -> `status: 'COMPLETED'`
  2. `Topic` -> `stabilityDays` advanced
  3. `Mistake` -> `resolved: true`
  4. `DailyProgress` -> `revisionsCompleted += 1`
  Inject a failure before commit (e.g. invalid document schema in DailyProgress).
- **Verification:**
  1. Transaction aborts.
  2. In MongoDB: `RevisionSchedule` remains `PENDING`.
  3. `Topic` stability is untouched.
  4. `Mistake` remains unresolved.
  5. `DailyProgress` counter remains unchanged.

#### Test 4: Concurrent Revision Completion Lock Verification
- **Scenario:** Send two simultaneous revision completion requests for the same `RevisionSchedule` ID.
- **Verification:**
  1. First request acquires document lock, transitions status from `PENDING` to `COMPLETED`, and commits.
  2. Second request fails the atomic query condition `{ _id, status: 'PENDING' }` and receives HTTP `409 REVISION_ALREADY_COMPLETED`.
  3. Topic stability is increased exactly once.

#### Test 5: Partial Unique Active-Revision Index Enforcement
- **Scenario:** Attempt to insert two `RevisionSchedule` documents for the same `(userId, topicId)` with `status: 'PENDING'`.
- **Verification:**
  1. MongoDB engine throws `MongoServerError: E11000 duplicate key error collection`.
  2. Second active schedule is rejected by the database engine itself.
  3. Mark first schedule `COMPLETED` and insert a new `PENDING` schedule: Insertion succeeds (verifying partial index filter `{ status: 'PENDING' }`).

---

## 7. Risks & Precautions

1. **Do Not Overwrite Existing Data:**
   - Under no circumstances should `C:\Program Files\MongoDB\Server\8.0\data` be designated as the `dbPath` for test runs or cleaned with `wipe`/`drop`.
   - Maintain a dedicated path: `C:\data\studyos_rs\db`.
2. **Localhost Network Binding:**
   - Always bind `mongod` exclusively to `127.0.0.1` (`bindIp: 127.0.0.1`). Do not bind to `0.0.0.0` on local development workstations without configuring authorization and TLS.
3. **Database Drop Boundaries in Tests:**
   - Real integration test teardown scripts must only drop `studyos_test` databases:
     ```ts
     if (mongoose.connection.name !== 'studyos_test') {
       throw new Error('Safety Guard: Refusing to drop non-test database!');
     }
     await mongoose.connection.db.dropDatabase();
     ```
4. **Oplog Sizing:**
   - For a single-node replica set on a development machine, cap the oplog size (e.g., `--oplogSizeMB 512`) to prevent unbounded disk space consumption.

---

## Conclusion & Next Steps

The environment is in an ideal state to execute the activation plan:
- Existing tools (`mongosh`, Database Tools, Compass) are current.
- Port `27017` is free.
- The path forward is clean and completely protects existing project data.
- Once the user decides to proceed with installation, the single-node replica set can be stood up in under 5 minutes, unlocking genuine Tier 3 ACID integration testing.

