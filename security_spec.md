# StreetFlood Alert — Firestore Security Specification

## 1. Data Invariants
1. **Default Deny**: All paths not explicitly matched are denied read/write.
2. **PII Isolation**: User emails, phone numbers, and FCM tokens live exclusively under `/users/{userId}/private/contact` and `/subscriptions/{subscriptionId}` and are readable only by the owning UID or verified admin.
3. **Role Protection**: Residents cannot self-assign `role: 'admin'` on `/users/{userId}` creation or update; role elevation is strictly restricted to verified admins.
4. **Civic Telemetry Integrity**: Only verified municipal admins can create, edit, or delete `/streets`, `/sensors`, `/readings`, or `/alerts`.
5. **Community Report State Machine**: Signed-in verified users can submit `/reports` only with `authorId == request.auth.uid`, `status == 'unverified'`, and `confirmations == 1`. Terminal state `'resolved'` is locked for non-admins.
6. **Temporal Integrity & Immutability**: `createdAt` and `updatedAt` must match `request.time`; `createdAt`, `uid`, and `authorId` are immutable after creation.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated write to `/streets/anna-salai`.
2. Resident attempting to create `/users/{uid}` with `role: 'admin'`.
3. Resident attempting to update their own `/users/{uid}` to elevate `role` to `'admin'`.
4. Non-owner attempting to read `/users/{otherUid}/private/contact`.
5. Non-owner attempting to list `/subscriptions` without matching `userId`.
6. Unverified email user attempting to create `/reports/{id}`.
7. Spoofed `authorId` in `/reports/{id}` (`authorId != request.auth.uid`).
8. Shadow update adding `isAdmin: true` ghost field to `/reports/{id}`.
9. Resident attempting to jump report directly to `status: 'verified'` on create.
10. Reporter attempting to mutate an already `'resolved'` report.
11. Oversized `1.5KB` document ID injection on `/reports/{oversizedId}`.
12. Client-spoofed `createdAt` timestamp not equal to `request.time`.
