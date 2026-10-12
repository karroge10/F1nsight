import { BroadcastRedirect } from "@/components/live/broadcast-redirect";

/** The broadcast layout became the live page; old links keep their session. */
export default function BroadcastPage() {
  return <BroadcastRedirect />;
}
