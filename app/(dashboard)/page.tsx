import { redirect } from "next/navigation";

// The all-projects dashboard will live here. Until then, Projects is home.
export default function Home() {
  redirect("/projects");
}
