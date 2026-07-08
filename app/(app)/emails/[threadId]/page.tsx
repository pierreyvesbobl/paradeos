import { redirect } from "next/navigation";

type Params = Promise<{ threadId: string }>;

export default async function LegacyThreadPage({ params }: { params: Params }) {
  const { threadId } = await params;
  redirect(`/emails?thread=${threadId}`);
}
