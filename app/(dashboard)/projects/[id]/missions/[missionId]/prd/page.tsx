import { Suspense } from "react";
import { PrdReview } from "@/components/prd-review";

export default function MissionPrdPage({ params }: PageProps<"/projects/[id]/missions/[missionId]/prd">) {
  return (
    <Suspense>
      <PrdFromParams params={params} />
    </Suspense>
  );
}

async function PrdFromParams({
  params,
}: Pick<PageProps<"/projects/[id]/missions/[missionId]/prd">, "params">) {
  const { id, missionId } = await params;
  return <PrdReview projectId={id} missionId={missionId} />;
}
