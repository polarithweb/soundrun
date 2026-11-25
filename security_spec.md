# Security Specification — Echo Meadow Run Leaderboard

## Access Model
The user explicitly requested an open, passwordless arcade leaderboard with zero authentication friction ("no restriction no authorisation, anyone can just place their name and play no password nothing"). Because there is no user login, security focuses on **zero PII storage**, **strict schema & size enforcement**, **Denial-of-Wallet prevention**, **monotonic high-score integrity**, **server-verified timestamps**, and **no destructive deletes**.

## Data Invariants
1. Default-deny catch-all (`/{document=**}`) blocks access to any undeclared collection.
2. Every `/leaderboard/{playerId}` document ID must satisfy `isValidId(playerId)` (`4..64` alphanumeric/`_`/`-`).
3. Every write must pass `isValidLeaderboardEntry(incoming(), playerId)` enforcing exact keys (`hasAll` + `hasOnly`), exact field types, bounded string lengths (`playerName` 1..24 chars), bounded non-negative integers (`bestScore <= 10000000`, `bestDistance <= 1000000`, `coinsCollected <= 1000000`, `pinkCoinsCollected <= 100000`), and matching `incoming().playerId == playerId`.
4. `createdAt` must equal `request.time` on create and remain immutable forever on update; `updatedAt` must equal `request.time` on both create and update.
5. Score updates are monotonic (`incoming().bestScore >= existing().bestScore`) so high scores cannot be downgraded or zeroed out.
6. `delete` is unconditionally denied (`allow delete: if false`).
7. No PII (`email`, `phone`, `address`, `ip`) is ever accepted due to strict `hasOnly`.

## The "Dirty Dozen" Adversarial Payloads (Must All Be Rejected)
1. **Shadow/Ghost Field Injection**: Create/update including `{ isAdmin: true }` or `{ email: "a@b.com" }` -> Rejected by `hasOnly`.
2. **Oversized Document ID Poisoning**: `/leaderboard/` with 200-char ID or special chars (`../admin`) -> Rejected by `isValidId`.
3. **Oversized Display Name (DoW)**: `playerName` of 5,000 characters -> Rejected by `playerName.size() <= 24`.
4. **Empty / Whitespace-Only Name**: `playerName: ""` -> Rejected by `playerName.size() >= 1`.
5. **Path/Payload ID Mismatch**: Path `/leaderboard/player_A` with `playerId: "player_B"` -> Rejected by `data.playerId == playerId`.
6. **Negative or Float Score Poisoning**: `bestScore: -500` or `bestScore: 12.5` or `bestScore: "9999"` -> Rejected by `is int && >= 0`.
7. **Overflow Score Poisoning**: `bestScore: 999999999999` -> Rejected by `<= 10000000`.
8. **Client-Spoofed Timestamp**: `createdAt: "2020-01-01T00:00:00Z"` instead of `serverTimestamp()` -> Rejected by `== request.time`.
9. **Immutable Field Tampering**: Updating `createdAt` or `playerId` on an existing document -> Rejected by immutability checks & `affectedKeys().hasOnly(...)`.
10. **High-Score Sabotage (Downgrade)**: Updating an existing 50,000-point entry down to `bestScore: 0` -> Rejected by `incoming().bestScore >= existing().bestScore`.
11. **Unauthorized Deletion**: Deleting any `/leaderboard/{playerId}` document -> Rejected by `allow delete: if false`.
12. **Undeclared Collection Access**: Reading or writing `/secrets/1` or `/users/1` -> Rejected by default-deny catch-all.
