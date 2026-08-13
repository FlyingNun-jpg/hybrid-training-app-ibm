// Minimal declarations for web-push (the package ships no types we rely on, and
// this keeps typechecking green before `npm install` has run locally).
declare module 'web-push' {
  export type PushSubscriptionRecord = { endpoint: string; keys: { p256dh: string; auth: string } }
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void
  export function sendNotification(subscription: PushSubscriptionRecord, payload?: string): Promise<unknown>
  const webpush: { setVapidDetails: typeof setVapidDetails; sendNotification: typeof sendNotification }
  export default webpush
}
