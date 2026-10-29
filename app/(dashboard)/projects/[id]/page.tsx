import { Suspense } from "react";
import { ProjectMissionControl } from "@/components/project-mission-control";

export default function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  return (
    <Suspense>
      <ProjectFromParams params={params} />
    </Suspense>
  );
}

async function ProjectFromParams({ params }: Pick<PageProps<"/projects/[id]">, "params">) {
  const { id } = await params;
  return <ProjectMissionControl id={id} />;
}
