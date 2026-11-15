/**
 * StreetFlood Alert — Dirty Dozen Firestore Security Rule Verification Vectors
 * Documents the 12 adversarial payloads that must evaluate to PERMISSION_DENIED.
 */

export interface SecurityTestVector {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_VECTORS: SecurityTestVector[] = [
  {
    id: 1,
    name: 'Unauthenticated write to monitored street',
    operation: 'create',
    path: '/streets/anna-salai',
    auth: null,
    payload: { name: 'Hacked Street', drainDepthCm: 100 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Resident self-assigning admin role on profile creation',
    operation: 'create',
    path: '/users/user_1',
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { uid: 'user_1', displayName: 'Resident', role: 'admin', preferredLang: 'en' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Resident escalating role on profile update',
    operation: 'update',
    path: '/users/user_1',
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { role: 'admin' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Non-owner reading isolated PII private contact',
    operation: 'get',
    path: '/users/user_1/private/contact',
    auth: { uid: 'user_2', email: 'other@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Non-owner reading another resident subscription',
    operation: 'get',
    path: '/subscriptions/sub_user_1',
    auth: { uid: 'user_2', email: 'other@example.com', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unverified email user submitting community report',
    operation: 'create',
    path: '/reports/rep_1',
    auth: { uid: 'user_1', email: 'unverified@example.com', email_verified: false },
    payload: { authorId: 'user_1', streetId: 'anna-salai', status: 'unverified' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Spoofed authorId in community report',
    operation: 'create',
    path: '/reports/rep_2',
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { authorId: 'user_victim', streetId: 'anna-salai', status: 'unverified', confirmations: 1 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Shadow update adding ghost field to report',
    operation: 'update',
    path: '/reports/rep_2',
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { confirmations: 2, isAdminVerified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Reporter creating pre-verified report',
    operation: 'create',
    path: '/reports/rep_3',
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { authorId: 'user_1', streetId: 'anna-salai', status: 'verified', confirmations: 1 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Mutating terminal resolved report as non-admin',
    operation: 'update',
    path: '/reports/rep_resolved',
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { confirmations: 3 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Oversized document ID poisoning (>128 chars)',
    operation: 'create',
    path: `/reports/${'x'.repeat(200)}`,
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { authorId: 'user_1', streetId: 'anna-salai' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Client-spoofed timestamp on report creation',
    operation: 'create',
    path: '/reports/rep_4',
    auth: { uid: 'user_1', email: 'resident@example.com', email_verified: true },
    payload: { authorId: 'user_1', createdAt: '1999-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
